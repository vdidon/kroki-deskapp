# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow", "zopfli"]
# ///
"""Draws the file-type icons (Explorer / file manager), one per format.

No page behind the glyph: the background is transparent and the type's glyph
fills the whole square. A white page with a folded corner (VS Code's style)
spent a third of the width on its margins and its outline, which left the
glyph 8 px wide at 16 px — unreadable; and its white block glared in a dark
Explorer. The Kroki Desk badge (the application's graph, two nodes over one)
sits in the lower right corner, on a transparent halo cut out of the glyph.

Every color must read on a light **and** a dark background (Explorer follows
the system theme): mid-tone, saturated colors only — no navy, no white fill.

Output: 256×256 RGBA PNG masters, tracked. The xtask derives everything else
from them at build time (multi-size .ico for the MSI, hicolor PNGs for the
.deb — `xtask/src/icons.rs`), through the same code as the icons shipped by the
plugins (`fileIcons` field of the manifest, plugin protocol §3): one converter,
whatever the source.

    src-tauri/icons/files/{session,plugin,markdown,text,html,document}.png
    plugins/latex-doc/icons/tex.png

Re-run after changing a drawing: `uv run scripts/file_icons.py`. Drawn at 4×
then reduced (antialiasing); the strokes are thick on purpose — 32 master
units = 2 px at 16 px, the thinnest stroke that survives the reduction.
"""

from __future__ import annotations

import io
from pathlib import Path

import zopfli.png
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src-tauri" / "icons" / "files"

SIZE = 256
S = 4  # supersampling
W = SIZE * S

# Badge: the application icon's palette, deepened so it holds on both themes.
INDIGO = (91, 91, 214, 255)
LINK = (66, 133, 230, 255)
PALE = (239, 246, 255, 255)
WHITE = (255, 255, 255, 255)
CLEAR = (0, 0, 0, 0)  # ImageDraw writes pixels as is: drawing CLEAR erases.

# Glyph colors.
BLUE = (30, 115, 225, 255)
GREY = (128, 136, 150, 255)
ORANGE = (232, 102, 40, 255)
TEAL = (0, 150, 136, 255)
GREEN = (67, 160, 71, 255)
TEX_INK = (0, 140, 140, 255)


def px(v: float) -> int:
    """Master coordinate (0..256) → supersampled canvas."""
    return round(v * S)


def pts(points) -> list[tuple[int, int]]:
    return [(px(x), px(y)) for x, y in points]


def box(x0: float, y0: float, x1: float, y1: float) -> tuple[int, int, int, int]:
    return px(x0), px(y0), px(x1), px(y1)


def font(names: list[str], size: float) -> ImageFont.FreeTypeFont:
    for n in names:
        try:
            return ImageFont.truetype(n, px(size))
        except OSError:
            continue
    raise SystemExit(f"none of the fonts {names} is installed")


SERIF = ["timesbd.ttf", "DejaVuSerif-Bold.ttf"]

# Badge geometry: nodes a, b on top, c (the M) below; corner = lower right.
BA, BB, BC = (172, 184), (234, 184), (203, 234)
BR, BRC = 16, 19


def badge_halo(d: ImageDraw.ImageDraw) -> None:
    """Transparent ring cut out of the glyph around the badge."""
    for p, q in ((BA, BB), (BA, BC), (BB, BC)):
        d.line([px(p[0]), px(p[1]), px(q[0]), px(q[1])], fill=CLEAR, width=px(26))
    for p, rad in ((BA, BR), (BB, BR), (BC, BRC)):
        d.ellipse(box(p[0] - rad - 8, p[1] - rad - 8, p[0] + rad + 8, p[1] + rad + 8), fill=CLEAR)
    d.polygon(pts([BA, BB, BC]), fill=CLEAR)


def badge(d: ImageDraw.ImageDraw) -> None:
    """The application's graph, lower right."""
    for p, q in ((BA, BB), (BA, BC), (BB, BC)):
        d.line([px(p[0]), px(p[1]), px(q[0]), px(q[1])], fill=LINK, width=px(10))
    for p in (BA, BB):
        d.ellipse(box(p[0] - BR, p[1] - BR, p[0] + BR, p[1] + BR), fill=PALE, outline=LINK, width=px(6))
    c = BC
    d.ellipse(box(c[0] - BRC, c[1] - BRC, c[0] + BRC, c[1] + BRC), fill=INDIGO, outline=LINK, width=px(6))
    m = [(c[0] - 9, c[1] + 9), (c[0] - 9, c[1] - 8), (c[0], c[1] + 2), (c[0] + 9, c[1] - 8), (c[0] + 9, c[1] + 9)]
    d.line(pts(m), fill=WHITE, width=px(5), joint="curve")


# --------------------------------------------------------------------------- #
# Glyphs — the whole square (≈ 12..244); the lower right corner (x > 150,
# y > 160) is taken by the badge, keep the strong strokes out of it.
# --------------------------------------------------------------------------- #


def bars(d: ImageDraw.ImageDraw, color, widths, y: float, step: float, h: float = 28) -> None:
    for i, w in enumerate(widths):
        yy = y + i * step
        d.rounded_rectangle(box(16, yy, 16 + w, yy + h), radius=px(h / 2), fill=color)


# The Markdown mark (official geometry, viewBox 208×128), filled variant: a
# solid block with M↓ cut out holds at 16 px where the outlined one blurs.
MD_M = [(30, 98), (30, 30), (50, 30), (70, 55), (90, 30), (110, 30), (110, 98),
        (90, 98), (90, 59), (70, 84), (50, 59), (50, 98)]  # fmt: skip
MD_ARROW = [(155, 98), (125, 65), (145, 65), (145, 30), (165, 30), (165, 65), (185, 65)]


def g_markdown(d: ImageDraw.ImageDraw) -> None:
    """The Markdown mark, full width and at the top: its 208×128 ratio leaves
    the bottom strip free, where the badge sits without covering the arrow."""
    k, ox, oy = 244 / 208, 6, 8

    def t(points):
        return pts([(ox + x * k, oy + y * k) for x, y in points])

    d.rounded_rectangle(box(ox, oy, ox + 208 * k, oy + 128 * k), radius=px(16 * k), fill=BLUE)
    d.polygon(t(MD_M), fill=CLEAR)
    d.polygon(t(MD_ARROW), fill=CLEAR)


def g_text(d: ImageDraw.ImageDraw) -> None:
    bars(d, GREY, widths=(224, 180, 224, 130, 100), y=30, step=44)


def g_html(d: ImageDraw.ImageDraw) -> None:
    w = px(34)
    d.line(pts([(78, 52), (24, 118), (78, 184)]), fill=ORANGE, width=w, joint="curve")
    d.line(pts([(178, 52), (232, 118), (178, 184)]), fill=ORANGE, width=w, joint="curve")
    d.line(pts([(150, 30), (106, 206)]), fill=ORANGE, width=w)


def g_session(d: ImageDraw.ImageDraw) -> None:
    """Two windows with their tab bars: a session = windows → tabs."""
    for x, y in ((14, 22), (74, 86)):
        d.rounded_rectangle(box(x - 10, y - 10, x + 178, y + 140), radius=px(22), fill=CLEAR)
        d.rounded_rectangle(box(x, y, x + 168, y + 130), radius=px(16), outline=TEAL, width=px(20))
        d.rectangle(box(x + 8, y + 8, x + 160, y + 44), fill=TEAL)
        d.rectangle(box(x + 22, y + 22, x + 72, y + 44), fill=CLEAR)


def g_plugin(d: ImageDraw.ImageDraw) -> None:
    """Puzzle piece."""
    d.rounded_rectangle(box(40, 70, 200, 232), radius=px(18), fill=GREEN)
    d.ellipse(box(88, 20, 152, 84), fill=GREEN)  # top knob
    d.ellipse(box(186, 120, 248, 182), fill=GREEN)  # right knob
    d.ellipse(box(14, 122, 66, 174), fill=CLEAR)  # left socket


def g_document(d: ImageDraw.ImageDraw) -> None:
    """Generic: format served by a plugin that ships no icon."""
    bars(d, GREY, widths=(224, 170), y=20, step=46)
    d.line(pts([(40, 196), (100, 138), (156, 176)]), fill=INDIGO, width=px(20))
    for x, y in ((40, 196), (100, 138), (156, 176)):
        d.ellipse(box(x - 24, y - 24, x + 24, y + 24), fill=INDIGO)


def g_tex(d: ImageDraw.ImageDraw) -> None:
    """The TeX logo: the E lowered."""
    f = font(SERIF, 130)
    d.text((px(4), px(28)), "T", font=f, fill=TEX_INK)
    d.text((px(76), px(70)), "E", font=f, fill=TEX_INK)
    d.text((px(154), px(28)), "X", font=f, fill=TEX_INK)


def render(glyph, with_badge: bool = True) -> Image.Image:
    img = Image.new("RGBA", (W, W), CLEAR)
    d = ImageDraw.Draw(img)
    glyph(d)
    if with_badge:
        badge_halo(d)
        badge(d)
    return img.resize((SIZE, SIZE), Image.Resampling.LANCZOS)


ICONS = {
    OUT / "session.png": g_session,
    OUT / "plugin.png": g_plugin,
    OUT / "markdown.png": g_markdown,
    OUT / "text.png": g_text,
    OUT / "html.png": g_html,
    OUT / "document.png": g_document,
    ROOT / "plugins" / "latex-doc" / "icons" / "tex.png": g_tex,
}


if __name__ == "__main__":
    for path, glyph in ICONS.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        buf = io.BytesIO()
        render(glyph).save(buf, "PNG")
        # The masters are tracked: every byte stays in the git history.
        # zopfli re-deflates losslessly (same pixels), ~25 % below Pillow.
        path.write_bytes(zopfli.png.optimize(buf.getvalue()))
        print(path.relative_to(ROOT).as_posix())
