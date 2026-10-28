//! Windows drag-drop: replaces wry's `IDropTarget` with our own.
//!
//! wry (`webview2/drag_drop.rs`) installs an `IDropTarget` on every child
//! window of the webview and extracts **only** the `CF_HDROP` format (files
//! dropped from Explorer). Chromium/Electron-based editors (VS Code,
//! **Cursor**…) do not drop `CF_HDROP` but the file's path as **text**
//! (`CF_UNICODETEXT` / `text/uri-list`) — hence the lack of reaction (telltale
//! test: a Cursor → Notepad drop pastes the path).
//!
//! We reproduce wry's enumeration of the children, revoke its target and
//! register ours, which handles `CF_HDROP` **and** text. Opening is done
//! directly on the Rust side (`manager::open_mixed_paths`, which sorts
//! documents, `.kdws` sessions and `.kdext` archives); the drop overlay is
//! driven via the `drop-overlay` event (cf. `ui/js/filedrop.js`).

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
    /// `RegisterDragDrop` increments the target's COM refcount, but we also
    /// keep a strong reference here so as not to depend on any OLE detail.
    /// Lives on the UI thread; a few entries per window, never purged (HWND
    /// destruction auto-revokes on the OLE side) — negligible.
    static TARGETS: RefCell<Vec<IDropTarget>> = const { RefCell::new(Vec::new()) };
}

/// Installs our `IDropTarget` on the window (and its webview children).
/// To be called after `show()`: the WebView2 child window must already exist.
pub fn install(window: &WebviewWindow) {
    let win = window.clone();
    // `RegisterDragDrop` must run on the thread that owns the HWND and called
    // `OleInitialize` (the event loop's thread).
    let _ = window.run_on_main_thread(move || {
        // `hwnd()` returns the HWND of the `windows` version pulled in by Tauri,
        // distinct from ours. Same raw pointer → we rebuild the type.
        let Ok(raw) = win.hwnd() else { return };
        let parent = HWND(raw.0);
        let app = win.app_handle().clone();
        let label = win.label().to_string();
        unsafe { register_on_children(parent, &app, &label) };
    });
}

unsafe fn register_on_children(parent: HWND, app: &AppHandle, label: &str) {
    // Enumerates the child windows like wry does, to target the WebView2 HWND(s).
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
        // Revokes wry's target then registers ours. The condition
        // (≠ INVALIDHWND) filters out HWNDs that do not accept a drop target,
        // as wry does.
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
    /// Does the current drag contain at least one supported file? Avoids
    /// re-scanning the disk in `DragOver` (called in bursts).
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
        // Documents, `.kdws` sessions and `.kdext` archives: sorting and
        // routing (tabs / `session::open_session` / install flow) are done
        // once and for all by `open_mixed_paths`, shared with the CLI and the
        // second instance.
        crate::manager::open_mixed_paths(&self.app, &self.label, &paths);
        Ok(())
    }
}

/// Extracts the supported file paths from a drag, whatever its format: first
/// `CF_HDROP` (Explorer), otherwise text (Cursor/VS Code).
unsafe fn extract_paths(obj: &IDataObject) -> Vec<PathBuf> {
    if let Some(paths) = unsafe { hdrop_paths(obj) } {
        return filter_supported(paths);
    }
    if let Some(text) = unsafe { text_payload(obj) } {
        return filter_supported(parse_text_paths(&text));
    }
    Vec::new()
}

/// Reads `CF_HDROP` (shell file format). `None` if absent.
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
    // 0xFFFFFFFF → number of items.
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

/// Reads `CF_UNICODETEXT` (path dropped as text by Cursor/VS Code). `None` if
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
    let max = unsafe { GlobalSize(hglobal) } / 2; // bytes → u16
    let mut len = 0usize;
    while len < max && unsafe { *ptr.add(len) } != 0 {
        len += 1;
    }
    let text = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(ptr, len) });
    let _ = unsafe { GlobalUnlock(hglobal) };
    unsafe { ReleaseStgMedium(&mut medium) };
    Some(text)
}

/// Splits a text payload into paths. Handles the `text/uri-list` format
/// (`file://…` lines, `#` comments) as well as raw paths.
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

/// Converts the remainder of a `file://` URI into a Windows path. `dunce::canonicalize`
/// will validate afterwards; an approximate conversion is filtered out by `is_file`.
fn file_uri_to_path(rest: &str) -> PathBuf {
    let decoded = percent_decode(rest);
    match decoded.strip_prefix('/') {
        // "/C:/dir/x.md" → local drive
        Some(drive) => PathBuf::from(drive.replace('/', "\\")),
        // "server/share/x" → UNC
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

/// Canonicalizes and expands the dropped paths into openable documents:
/// a supported file is kept, a **folder** is expanded into its direct Markdown
/// files (cf. `manager::expand_dropped_docs`). Covers Explorer
/// (`CF_HDROP`) and Cursor/VS Code (text) identically.
fn filter_supported(paths: Vec<PathBuf>) -> Vec<PathBuf> {
    crate::manager::expand_dropped_docs(&paths)
}
