// Thème de l'interface : « auto » (suit le système) | « light » | « dark ».
//
// Stratégie : en mode « auto » on ne pose AUCUN attribut sur <html> — la palette,
// le surlignage de code et la carte des diagrammes suivent alors `@media
// (prefers-color-scheme)` en pur CSS (premier rendu sans flash + suivi automatique
// des bascules système). Seuls « light »/« dark » forcent un override via
// [data-theme], qui neutralise les media-queries (cf. app.css). La CSP interdisant
// tout <script> inline, on ne peut pas appliquer l'override avant le premier paint :
// un utilisateur qui force un thème contraire à son système verra un bref flash —
// accepté, car le cas par défaut (auto) reste sans flash.

const root = document.documentElement;
const mql = window.matchMedia?.("(prefers-color-scheme: dark)");

let currentMode = "auto";
let onSystemChange = null;

// highlight.js : deux feuilles gouvernées par media-query en « auto », forcées via
// l'attribut `media` en override explicite.
function applyHljs(mode) {
  const light = document.getElementById("hljs-light");
  const dark = document.getElementById("hljs-dark");
  if (!light || !dark) return;
  if (mode === "auto") {
    light.media = "(prefers-color-scheme: light)";
    dark.media = "(prefers-color-scheme: dark)";
  } else {
    light.media = mode === "light" ? "all" : "not all";
    dark.media = mode === "dark" ? "all" : "not all";
  }
}

export function applyTheme(mode) {
  currentMode = mode === "light" || mode === "dark" ? mode : "auto";
  if (currentMode === "auto") root.removeAttribute("data-theme");
  else root.dataset.theme = currentMode;
  applyHljs(currentMode);
}

// Thème effectif courant (résout « auto » via la préférence système). Utilisé par
// render.js pour figer la couleur de texte/grilles d'une figure Plotly au rendu.
export function docIsDark() {
  const explicit = root.dataset.theme;
  if (explicit === "dark") return true;
  if (explicit === "light") return false;
  return mql?.matches ?? false;
}

// À appeler une fois au boot : suit les bascules système, mais seulement en mode
// « auto » (sinon l'override prime). Le callback sert à réaccorder les figures
// Plotly — leurs couleurs sont figées au rendu, alors que la palette CSS suit seule.
export function initTheme(systemChangeCallback) {
  onSystemChange = systemChangeCallback;
  mql?.addEventListener?.("change", () => {
    if (currentMode === "auto") onSystemChange?.();
  });
}
