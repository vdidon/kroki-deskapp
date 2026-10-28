// @ts-check

// Common foundation: Tauri access, window state, small utilities.

export const { invoke, convertFileSrc } = window.__TAURI__.core;
export const { listen } = window.__TAURI__.event;
export const currentLabel =
  window.__TAURI__.webviewWindow.getCurrentWebviewWindow().label;

/** @type {import("../../types/app").AppState} */
export const state = {
  tabs: [], // [{id, title, path}]
  active: null, // id of the active document or null
  views: new Map(), // id -> {el, rendered, seq}
  stale: new Set(), // documents modified on disk, to re-render on activation
};

// Static HTML page (including the app's exports): displayed in a sandboxed
// iframe, outside the markdown pipeline (cf. renderHtmlDocument, render.js).
/** @param {string | null | undefined} path */
export function isHtmlPath(path) {
  return /\.html?$/i.test(String(path ?? ""));
}

/**
 * @param {unknown} s
 * @returns {string}
 */
export function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// UTF-8-safe Base64 (carries the diagram source through data-attributes).
/**
 * @param {string} s
 * @returns {string}
 */
export function b64encode(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * @param {string} s
 * @returns {string}
 */
export function b64decode(s) {
  return new TextDecoder().decode(
    Uint8Array.from(atob(s), (c) => c.charCodeAt(0)),
  );
}
