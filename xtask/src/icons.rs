//! File-type icons for the installers: one master PNG per type, every other
//! format derived here.
//!
//! Masters: `src-tauri/icons/files/<name>.png` for the native formats (drawn
//! by `scripts/file_icons.py`, tracked) and, for the formats of a plugin, the
//! PNGs its manifest declares in `fileIcons` (read inside the `.kdext`, see
//! `bundled::read_manifest`). Square, at least [`MIN_SIZE`] px.
//!
//! Outputs, under `src-tauri/file-icons/` (gitignored, emptied by
//! `bundled::stage`):
//! - `<name>.ico`: multi-size icon (16 → 256) for the `DefaultIcon` of a
//!   Windows ProgID. Explorer picks the size it needs; an ICO holding only
//!   256 px would be reduced by Windows with a crude filter;
//! - `linux/<n>x<n>/<icon-name>.png`: the hicolor theme sizes, installed by
//!   the .deb under `/usr/share/icons/hicolor/<n>x<n>/mimetypes/`.
//!
//! The reduction is an area average over premultiplied alpha — no `image`
//! dependency for a box filter, and premultiplying avoids the dark fringe that
//! transparent pixels would otherwise leak into the antialiased edges.

use std::fs;
use std::path::Path;

use ico::{IconDir, IconDirEntry, IconImage, ResourceType};

use crate::die;

/// Smallest accepted master: below it the 48 px Explorer view would be
/// upscaled.
pub const MIN_SIZE: u32 = 48;
/// Sizes embedded in each `.ico` (those Explorer requests, by DPI and view).
const ICO_SIZES: &[u32] = &[16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
/// hicolor directories the .deb fills.
pub const HICOLOR_SIZES: &[u32] = &[16, 24, 32, 48, 64, 128, 256];

/// Native masters (`src-tauri/icons/files/<name>.png`). `document` is the
/// generic one, for the formats of a plugin that ships no icon.
pub const NATIVE: &[&str] = &["session", "plugin", "markdown", "text", "html", "document"];

/// Decodes and validates a master; `what` names it in the error messages.
pub fn decode(bytes: &[u8], what: &str, cmd: &str) -> IconImage {
    let img = IconImage::read_png(bytes)
        .unwrap_or_else(|e| die(&format!("{cmd}: {what}: not a readable PNG: {e}")));
    let (w, h) = (img.width(), img.height());
    if w != h || w < MIN_SIZE {
        die(&format!(
            "{cmd}: {what}: {w}×{h} px — an icon must be square, {MIN_SIZE} px at least (256 recommended)"
        ));
    }
    img
}

pub fn read_native(repo: &Path, name: &str, cmd: &str) -> IconImage {
    let path = repo.join(format!("src-tauri/icons/files/{name}.png"));
    let bytes = fs::read(&path).unwrap_or_else(|e| {
        die(&format!(
            "{cmd}: {} unreadable ({e}) — regenerate with `uv run scripts/file_icons.py`",
            path.display()
        ))
    });
    decode(&bytes, &path.display().to_string(), cmd)
}

/// Writes `<dir>/<name>.ico`.
pub fn write_ico(img: &IconImage, dir: &Path, name: &str, cmd: &str) {
    let mut icon = IconDir::new(ResourceType::Icon);
    for &n in ICO_SIZES.iter().filter(|&&n| n <= img.width()) {
        let entry = IconDirEntry::encode(&resize(img, n))
            .unwrap_or_else(|e| die(&format!("{cmd}: encoding {name}.ico ({n} px): {e}")));
        icon.add_entry(entry);
    }
    let path = dir.join(format!("{name}.ico"));
    let file = fs::File::create(&path)
        .unwrap_or_else(|e| die(&format!("{cmd}: cannot create {}: {e}", path.display())));
    icon.write(file)
        .unwrap_or_else(|e| die(&format!("{cmd}: cannot write {}: {e}", path.display())));
}

/// Writes `<dir>/linux/<n>x<n>/<icon_name>.png` for every hicolor size the
/// master covers (never upscaled — the .deb overlay applies the same filter).
pub fn write_hicolor(img: &IconImage, dir: &Path, icon_name: &str, cmd: &str) {
    for &n in HICOLOR_SIZES.iter().filter(|&&n| n <= img.width()) {
        let sub = dir.join(format!("linux/{n}x{n}"));
        fs::create_dir_all(&sub)
            .unwrap_or_else(|e| die(&format!("{cmd}: cannot create {}: {e}", sub.display())));
        let path = sub.join(format!("{icon_name}.png"));
        let file = fs::File::create(&path)
            .unwrap_or_else(|e| die(&format!("{cmd}: cannot create {}: {e}", path.display())));
        resize(img, n)
            .write_png(file)
            .unwrap_or_else(|e| die(&format!("{cmd}: cannot write {}: {e}", path.display())));
    }
}

/// For each destination pixel along one axis, the source pixels it covers and
/// the fraction of the destination pixel each one fills (sums to 1).
fn axis_weights(src: usize, dst: usize) -> Vec<Vec<(usize, f32)>> {
    let r = src as f32 / dst as f32;
    (0..dst)
        .map(|i| {
            let (a, b) = (i as f32 * r, (i + 1) as f32 * r);
            (a.floor() as usize..(b.ceil() as usize).min(src))
                .filter_map(|j| {
                    let cover = b.min(j as f32 + 1.0) - a.max(j as f32);
                    (cover > 0.0).then_some((j, cover / r))
                })
                .collect()
        })
        .collect()
}

/// Square `img` reduced to `n`×`n` (copied as is when already that size).
pub fn resize(img: &IconImage, n: u32) -> IconImage {
    let s = img.width() as usize;
    let n = n as usize;
    if s == n {
        return img.clone();
    }
    let pre: Vec<[f32; 4]> = img
        .rgba_data()
        .as_chunks::<4>()
        .0
        .iter()
        .map(|p| {
            let a = p[3] as f32 / 255.0;
            [
                p[0] as f32 * a,
                p[1] as f32 * a,
                p[2] as f32 * a,
                p[3] as f32,
            ]
        })
        .collect();
    let w = axis_weights(s, n);

    // Horizontal pass: s rows × n columns, then vertical: n × n.
    let mut rows = vec![[0f32; 4]; s * n];
    for y in 0..s {
        for (x, ws) in w.iter().enumerate() {
            let acc = &mut rows[y * n + x];
            for &(j, k) in ws {
                let p = pre[y * s + j];
                for c in 0..4 {
                    acc[c] += p[c] * k;
                }
            }
        }
    }
    let mut out = Vec::with_capacity(n * n * 4);
    for ws in &w {
        for x in 0..n {
            let mut acc = [0f32; 4];
            for &(j, k) in ws {
                let p = rows[j * n + x];
                for c in 0..4 {
                    acc[c] += p[c] * k;
                }
            }
            let a = acc[3];
            let un = if a > 0.0 { 255.0 / a } else { 0.0 };
            for v in &acc[..3] {
                out.push((v * un).round().clamp(0.0, 255.0) as u8);
            }
            out.push(a.round().clamp(0.0, 255.0) as u8);
        }
    }
    IconImage::from_rgba_data(n as u32, n as u32, out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(n: u32, px: [u8; 4]) -> IconImage {
        IconImage::from_rgba_data(n, n, px.repeat((n * n) as usize))
    }

    #[test]
    fn poids_couvrent_chaque_pixel() {
        for (s, d) in [(256, 16), (256, 48), (256, 20), (100, 32)] {
            for ws in axis_weights(s, d) {
                let sum: f32 = ws.iter().map(|&(_, k)| k).sum();
                assert!((sum - 1.0).abs() < 1e-4, "{s}→{d}: {sum}");
            }
        }
    }

    #[test]
    fn couleur_unie_conservee() {
        let r = resize(&solid(256, [10, 120, 230, 255]), 20);
        assert_eq!(r.width(), 20);
        assert!(r
            .rgba_data()
            .as_chunks::<4>()
            .0
            .iter()
            .all(|p| p == &[10, 120, 230, 255]));
    }

    #[test]
    fn transparent_sans_frange_sombre() {
        // Half opaque red, half fully transparent black: premultiplied, the
        // mixed pixel stays pure red at half opacity — not a dark red.
        let mut data = Vec::new();
        for _ in 0..2 {
            data.extend_from_slice(&[255, 0, 0, 255, 0, 0, 0, 0]);
        }
        let r = resize(&IconImage::from_rgba_data(2, 2, data), 1);
        let p = r.rgba_data();
        assert_eq!(&p[..3], &[255, 0, 0]);
        assert!((127..=128).contains(&p[3]));
    }

    #[test]
    fn ico_multi_tailles() {
        let dir = std::env::temp_dir().join(format!("kd-icons-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        write_ico(&solid(64, [0, 0, 0, 255]), &dir, "t", "test");
        let icon = IconDir::read(fs::File::open(dir.join("t.ico")).unwrap()).unwrap();
        let sizes: Vec<u32> = icon.entries().iter().map(|e| e.width()).collect();
        assert_eq!(sizes, [16, 20, 24, 32, 40, 48, 64]);
        let _ = fs::remove_dir_all(&dir);
    }
}
