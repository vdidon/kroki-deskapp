// @ts-check

// Sessions `.kdws` : bouton « Enregistrer la session » et retours utilisateur.
// L'ouverture d'une session est entièrement côté Rust (session.rs, routée par
// `manager::open_mixed_paths` quel que soit le canal : CLI, drop, dialog) ;
// ici on ne gère que la sauvegarde et l'affichage des rapports (toast).

import { invoke, listen } from "./app.js";
import { t } from "./i18n.js";

const toastEl = /** @type {HTMLElement} */ (document.getElementById("toast"));
/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer;

/** Toast transitoire en bas de fenêtre. Les erreurs restent plus longtemps.
 *  `actions` (`[{ label, run, title?, secondary? }]`) ajoute des boutons : le
 *  toast devient cliquable et reste le temps de le lire.
 * @typedef {object} ToastAction
 * @property {string} label
 * @property {() => void} run
 * @property {string | null} [title]
 * @property {boolean} [secondary]
 *
 * @param {string} message
 * @param {boolean} [error]
 * @param {ToastAction[]} [actions]
 */
export function showToast(message, error = false, actions = []) {
  toastEl.replaceChildren(message);
  for (const action of actions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = action.label;
    if (action.title) btn.title = action.title;
    btn.classList.toggle("secondary", !!action.secondary);
    btn.addEventListener("click", () => {
      toastEl.hidden = true;
      action.run();
    });
    toastEl.append(btn);
  }
  // Un toast cliquable reste 15 s : la croix permet de l'écarter tout de suite.
  if (actions.length) {
    const close = document.createElement("button");
    close.type = "button";
    close.className = "toast-close";
    close.textContent = "×";
    close.title = t("common.close");
    close.setAttribute("aria-label", t("common.close"));
    close.addEventListener("click", () => {
      clearTimeout(toastTimer);
      toastEl.hidden = true;
    });
    toastEl.append(close);
  }
  toastEl.classList.toggle("error", !!error);
  toastEl.classList.toggle("actionable", actions.length > 0);
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.hidden = true;
  }, actions.length ? 15000 : error ? 8000 : 3500);
}

export async function initSession() {
  const btn = /** @type {HTMLButtonElement} */ (document.getElementById("btn-save-session"));
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      // `false` = dialogue annulé : pas de toast.
      if (await invoke("save_session")) showToast(t("session.saved"));
    } catch (err) {
      showToast(String(err), true);
    } finally {
      btn.disabled = false;
    }
  });
  // Rapport d'ouverture d'une session (fichiers ignorés, `.kdws` illisible…),
  // émis par le backend vers cette fenêtre uniquement (`emit_to`).
  await listen("session-report", (e) => {
    showToast(e.payload.message, e.payload.error);
  });
}
