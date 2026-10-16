//! Drag-drop Windows : remplace le `IDropTarget` de wry par le nôtre.
//!
//! wry (`webview2/drag_drop.rs`) installe un `IDropTarget` sur chaque fenêtre
//! enfant de la webview et n'extrait **que** le format `CF_HDROP` (les fichiers
//! déposés par l'Explorateur). Les éditeurs basés sur Chromium/Electron
//! (VS Code, **Cursor**…) ne déposent pas de `CF_HDROP` mais le chemin du
//! fichier en **texte** (`CF_UNICODETEXT` / `text/uri-list`) — d'où l'absence de
//! réaction (test révélateur : un drop Cursor → Notepad colle le chemin).
//!
//! On reproduit l'énumération des enfants de wry, on révoque son target et on
//! enregistre le nôtre, qui gère `CF_HDROP` **et** le texte. L'ouverture est
//! faite directement côté Rust (`manager::open_mixed_paths`, qui trie documents,
//! sessions `.kdws` et archives `.kdext`) ; l'overlay de dépôt est piloté via
//! l'événement `drop-overlay` (cf. `ui/js/filedrop.js`).

use std::cell::{RefCell, UnsafeCell};
use std::ffi::{c_void, OsString};
use std::os::windows::ffi::OsStringExt;
use std::path::PathBuf;
use std::ptr;

use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::core::{implement, Ref, BOOL};
use windows::Win32::Foundation::{DRAGDROP_E_INVALIDHWND, HWND, LPARAM, POINTL};
use windows::Win32::System::Com::{IDataObject, DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL};
use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
use windows::Win32::System::Ole::{
    IDropTarget, IDropTarget_Impl, RegisterDragDrop, ReleaseStgMedium, RevokeDragDrop, CF_HDROP,
    CF_UNICODETEXT, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_NONE,
};
use windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS;
use windows::Win32::UI::Shell::{DragFinish, DragQueryFileW, HDROP};
use windows::Win32::UI::WindowsAndMessaging::EnumChildWindows;

thread_local! {
    /// `RegisterDragDrop` incrémente le refcount COM du target, mais on garde
    /// aussi une référence forte ici pour ne dépendre d'aucun détail OLE. Vit
    /// sur le thread UI ; quelques entrées par fenêtre, jamais purgées (la
    /// destruction du HWND auto-révoque côté OLE) — négligeable.
    static TARGETS: RefCell<Vec<IDropTarget>> = const { RefCell::new(Vec::new()) };
}

/// Installe notre `IDropTarget` sur la fenêtre (et ses enfants webview).
/// À appeler après `show()` : la fenêtre enfant WebView2 doit déjà exister.
pub fn install(window: &WebviewWindow) {
    let win = window.clone();
    // `RegisterDragDrop` doit s'exécuter sur le thread qui possède le HWND et a
    // appelé `OleInitialize` (le thread de la boucle d'événements).
    let _ = window.run_on_main_thread(move || {
        // `hwnd()` renvoie le HWND de la version de `windows` tirée par Tauri,
        // distincte de la nôtre. Même pointeur brut → on reconstruit le type.
        let Ok(raw) = win.hwnd() else { return };
        let parent = HWND(raw.0);
        let app = win.app_handle().clone();
        let label = win.label().to_string();
        unsafe { register_on_children(parent, &app, &label) };
    });
}

unsafe fn register_on_children(parent: HWND, app: &AppHandle, label: &str) {
    // Énumère les fenêtres enfants comme wry pour cibler le(s) HWND WebView2.
    let mut children: Vec<HWND> = Vec::new();
    {
        let mut callback = |hwnd: HWND| -> bool {
            children.push(hwnd);
            true
        };
        let mut trait_obj: &mut dyn FnMut(HWND) -> bool = &mut callback;
        let closure_ptr: *mut c_void = unsafe { std::mem::transmute(&mut trait_obj) };
        unsafe extern "system" fn enumerate_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
            let closure =
                unsafe { &mut *(lparam.0 as *mut c_void as *mut &mut dyn FnMut(HWND) -> bool) };
            closure(hwnd).into()
        }
        let _ = unsafe {
            EnumChildWindows(
                Some(parent),
                Some(enumerate_callback),
                LPARAM(closure_ptr as _),
            )
        };
    }

    for child in children {
        let target: IDropTarget = DropTarget {
            app: app.clone(),
            label: label.to_string(),
            valid: UnsafeCell::new(false),
        }
        .into();
        // Révoque le target de wry puis enregistre le nôtre. La condition
        // (≠ INVALIDHWND) filtre les HWND qui n'acceptent pas de drop target,
        // comme le fait wry.
        if unsafe { RevokeDragDrop(child) } != Err(DRAGDROP_E_INVALIDHWND.into())
            && unsafe { RegisterDragDrop(child, &target) }.is_ok()
        {
            TARGETS.with(|t| t.borrow_mut().push(target));
        }
    }
}

#[implement(IDropTarget)]
struct DropTarget {
    app: AppHandle,
    label: String,
    /// Le drag courant contient-il au moins un fichier supporté ? Évite de
    /// re-scanner le disque dans `DragOver` (appelé en rafale).
    valid: UnsafeCell<bool>,
}

impl DropTarget {
    fn set_overlay(&self, visible: bool) {
        let _ = self
            .app
            .emit_to(self.label.as_str(), "drop-overlay", visible);
    }
}

#[allow(non_snake_case)]
impl IDropTarget_Impl for DropTarget_Impl {
    fn DragEnter(
        &self,
        pdataobj: Ref<'_, IDataObject>,
        _grfkeystate: MODIFIERKEYS_FLAGS,
        _pt: &POINTL,
        pdweffect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        let valid = pdataobj
            .as_ref()
            .map(|o| !unsafe { extract_paths(o) }.is_empty())
            .unwrap_or(false);
        unsafe {
            *self.valid.get() = valid;
            *pdweffect = if valid {
                DROPEFFECT_COPY
            } else {
                DROPEFFECT_NONE
            };
        }
        if valid {
            self.set_overlay(true);
        }
        Ok(())
    }

    fn DragOver(
        &self,
        _grfkeystate: MODIFIERKEYS_FLAGS,
        _pt: &POINTL,
        pdweffect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        unsafe {
            *pdweffect = if *self.valid.get() {
                DROPEFFECT_COPY
            } else {
                DROPEFFECT_NONE
            };
        }
        Ok(())
    }

    fn DragLeave(&self) -> windows::core::Result<()> {
        if unsafe { *self.valid.get() } {
            self.set_overlay(false);
        }
        Ok(())
    }

    fn Drop(
        &self,
        pdataobj: Ref<'_, IDataObject>,
        _grfkeystate: MODIFIERKEYS_FLAGS,
        _pt: &POINTL,
        _pdweffect: *mut DROPEFFECT,
    ) -> windows::core::Result<()> {
        self.set_overlay(false);
        unsafe { *self.valid.get() = false };
        let paths = pdataobj
            .as_ref()
            .map(|o| unsafe { extract_paths(o) })
            .unwrap_or_default();
        // Documents, sessions `.kdws` et archives `.kdext` : le tri et le
        // routage (onglets / `session::open_session` / flux d'installation)
        // sont faits une fois pour toutes par `open_mixed_paths`, partagé avec
        // le CLI et la seconde instance.
        crate::manager::open_mixed_paths(&self.app, &self.label, &paths);
        Ok(())
    }
}

/// Extrait les chemins de fichiers supportés d'un drag, quel qu'en soit le
/// format : d'abord `CF_HDROP` (Explorateur), sinon le texte (Cursor/VS Code).
unsafe fn extract_paths(obj: &IDataObject) -> Vec<PathBuf> {
    if let Some(paths) = unsafe { hdrop_paths(obj) } {
        return filter_supported(paths);
    }
    if let Some(text) = unsafe { text_payload(obj) } {
        return filter_supported(parse_text_paths(&text));
    }
    Vec::new()
}

/// Lit `CF_HDROP` (format fichier-shell). `None` si absent.
unsafe fn hdrop_paths(obj: &IDataObject) -> Option<Vec<PathBuf>> {
    let format = FORMATETC {
        cfFormat: CF_HDROP.0,
        ptd: ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
    };
    let medium = unsafe { obj.GetData(&format) }.ok()?;
    let hdrop = HDROP(unsafe { medium.u.hGlobal }.0 as _);
    // 0xFFFFFFFF → nombre d'éléments.
    let count = unsafe { DragQueryFileW(hdrop, 0xFFFF_FFFF, None) };
    let mut paths = Vec::with_capacity(count as usize);
    for i in 0..count {
        let len = unsafe { DragQueryFileW(hdrop, i, None) } as usize;
        let mut buf = vec![0u16; len + 1];
        unsafe { DragQueryFileW(hdrop, i, Some(&mut buf)) };
        paths.push(OsString::from_wide(&buf[..len]).into());
    }
    unsafe { DragFinish(hdrop) };
    Some(paths)
}

/// Lit `CF_UNICODETEXT` (chemin déposé en texte par Cursor/VS Code). `None` si
/// absent.
unsafe fn text_payload(obj: &IDataObject) -> Option<String> {
    let format = FORMATETC {
        cfFormat: CF_UNICODETEXT.0,
        ptd: ptr::null_mut(),
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
    };
    let mut medium = unsafe { obj.GetData(&format) }.ok()?;
    let hglobal = unsafe { medium.u.hGlobal };
    let ptr = unsafe { GlobalLock(hglobal) } as *const u16;
    if ptr.is_null() {
        unsafe { ReleaseStgMedium(&mut medium) };
        return None;
    }
    let max = unsafe { GlobalSize(hglobal) } / 2; // octets → u16
    let mut len = 0usize;
    while len < max && unsafe { *ptr.add(len) } != 0 {
        len += 1;
    }
    let text = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(ptr, len) });
    let _ = unsafe { GlobalUnlock(hglobal) };
    unsafe { ReleaseStgMedium(&mut medium) };
    Some(text)
}

/// Découpe un payload texte en chemins. Gère le format `text/uri-list`
/// (lignes `file://…`, commentaires `#`) comme les chemins bruts.
fn parse_text_paths(text: &str) -> Vec<PathBuf> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(|l| match l.strip_prefix("file://") {
            Some(rest) => file_uri_to_path(rest),
            None => PathBuf::from(l),
        })
        .collect()
}

/// Convertit le reste d'une URI `file://` en chemin Windows. `dunce::canonicalize`
/// validera ensuite ; une conversion approximative est filtrée par `is_file`.
fn file_uri_to_path(rest: &str) -> PathBuf {
    let decoded = percent_decode(rest);
    match decoded.strip_prefix('/') {
        // "/C:/dir/x.md" → lecteur local
        Some(drive) => PathBuf::from(drive.replace('/', "\\")),
        // "serveur/partage/x" → UNC
        None => PathBuf::from(format!("\\\\{}", decoded.replace('/', "\\"))),
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

/// Canonicalise et développe les chemins déposés en documents ouvrables :
/// un fichier supporté est gardé, un **dossier** est développé en ses fichiers
/// Markdown directs (cf. `manager::expand_dropped_docs`). Couvre Explorateur
/// (`CF_HDROP`) et Cursor/VS Code (texte) de façon identique.
fn filter_supported(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    crate::manager::expand_dropped_docs(&paths)
}
