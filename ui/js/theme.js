// @ts-check
// Interface theme: "auto" (follows the system) | "light" | "dark".
//
// Strategy: in "auto" mode NO attribute is set on <html> — the palette, the code
// highlighting and the diagram map then follow `@media (prefers-color-scheme)`
// in pure CSS (first render without flash + automatic tracking of system
// switches). Only "light"/"dark" force an override via [data-theme], which
// neutralizes the media queries (cf. app.css). Since the CSP forbids any inline
// <script>, the override cannot be applied before the first paint: a user who
// forces a theme opposite to their system will see a brief flash — accepted,
// because the default case (auto) stays flash-free.

const root = document.documentElement;
const mql = window.matchMedia?.("(prefers-color-scheme: dark)");

/** @typedef {"auto" | "light" | "dark"} ThemeMode */

/** @type {ThemeMode} */
let currentMode = "auto";
/** @type {(() => void) | null} */
let onSystemChange = null;

// highlight.js: two stylesheets driven by media query in "auto", forced via the
// `media` attribute on an explicit override.
/** @param {ThemeMode} mode */
function applyHljs(mode) {
  const light = /** @type {HTMLLinkElement | null} */ (document.getElementById("hljs-light"));
  const dark = /** @type {HTMLLinkElement | null} */ (document.getElementById("hljs-dark"));
  if (!light || !dark) return;
  if (mode === "auto") {
    light.media = "(prefers-color-scheme: light)";
    dark.media = "(prefers-color-scheme: dark)";
  } else {
    light.media = mode === "light" ? "all" : "not all";
    dark.media = mode === "dark" ? "all" : "not all";
  }
}

/** @param {string} mode Persisted setting; any unknown value means "auto". */
export function applyTheme(mode) {
  currentMode = mode === "light" || mode === "dark" ? mode : "auto";
  if (currentMode === "auto") root.removeAttribute("data-theme");
  else root.dataset.theme = currentMode;
  applyHljs(currentMode);
}

// Current effective theme (resolves "auto" via the system preference). Used by
// render.js to freeze the text/grid color of a Plotly figure at render time.
export function docIsDark() {
  const explicit = root.dataset.theme;
  if (explicit === "dark") return true;
  if (explicit === "light") return false;
  return mql?.matches ?? false;
}

// Call once at boot: follows system switches, but only in "auto" mode
// (otherwise the override wins). The callback re-tunes the Plotly figures —
// their colors are frozen at render time, whereas the CSS palette follows on its own.
/** @param {() => void} systemChangeCallback */
export function initTheme(systemChangeCallback) {
  onSystemChange = systemChangeCallback;
  mql?.addEventListener?.("change", () => {
    if (currentMode === "auto") onSystemChange?.();
  });
}
