// @ts-check

// Socle commun : accès Tauri, état de la fenêtre, petits utilitaires.

export const { invoke, convertFileSrc } = window.__TAURI__.core;
export const { listen } = window.__TAURI__.event;
export const currentLabel =
  window.__TAURI__.webviewWindow.getCurrentWebviewWindow().label;

/** @type {import("../../types/app").AppState} */
export const state = {
  tabs: [], // [{id, title, path}]
  active: null, // id du document actif ou null
  views: new Map(), // id -> {el, rendered, seq}
  stale: new Set(), // documents modifiés sur disque, à re-rendre à l'activation
};

// Page HTML statique (dont les exports de l'app) : affichée dans une iframe
// sandboxée, hors du pipeline markdown (cf. renderHtmlDocument, render.js).
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

// Base64 sûr pour l'UTF-8 (transport du source des diagrammes via data-attributes).
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
