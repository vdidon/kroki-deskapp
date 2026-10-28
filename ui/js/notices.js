// @ts-check
// Dialog « Licences tierces » (ouvert depuis « Informations ») : affiche
// `ui/third-party-notices.txt`, les mentions de licence de tout ce que
// l'application embarque sans l'avoir écrit — crates Rust, vendors JS et leurs
// dépendances, jars. Fichier généré par `scripts/third_party_notices.py`,
// embarqué avec les autres assets (compressé par Tauri) et lu par `fetch` à la
// première ouverture : ~1,3 Mo de texte brut qu'aucune autre vue ne charge.

import { t } from "./i18n.js";

// Éléments statiques de ui/index.html.
const dialog = /** @type {HTMLDialogElement} */ (document.getElementById("notices-dialog"));
const body = /** @type {HTMLPreElement} */ (document.getElementById("notices-body"));

// Texte une fois chargé : figé à la compilation, inutile de le relire. Un
// échec n'est pas mémorisé — la réouverture retente, message dans la langue
// du moment.
let loaded = false;

export async function openNotices() {
  if (!loaded) {
    try {
      const resp = await fetch("third-party-notices.txt");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      body.textContent = await resp.text();
      body.classList.remove("settings-error");
      loaded = true;
    } catch (err) {
      body.textContent = t("notices.load_failed", { error: String(err) });
      body.classList.add("settings-error");
    }
  }
  dialog.showModal();
  body.scrollTop = 0;
}

export function initNotices() {
  /** @type {HTMLButtonElement} */ (document.getElementById("notices-close")).addEventListener(
    "click",
    () => dialog.close(),
  );
}
