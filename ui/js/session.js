// @ts-check

// `.kdws` sessions: "Save session" (« Enregistrer la session ») button and user feedback.
// Opening a session is entirely on the Rust side (session.rs, routed by
// `manager::open_mixed_paths` whatever the channel: CLI, drop, dialog);
// here we only handle saving and displaying reports (toast).

import { invoke, listen } from "./app.js";
import { t } from "./i18n.js";

const toastEl = /** @type {HTMLElement} */ (document.getElementById("toast"));
/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer;

/** Transient toast at the bottom of the window. Errors stay longer.
 *  `actions` (`[{ label, run, title?, secondary? }]`) adds buttons: the
 *  toast becomes clickable and stays long enough to be read.
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
  // A clickable toast stays 15 s: the cross dismisses it right away.
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
      // `false` = dialog cancelled: no toast.
      if (await invoke("save_session")) showToast(t("session.saved"));
    } catch (err) {
      showToast(String(err), true);
    } finally {
      btn.disabled = false;
    }
  });
  // Session opening report (skipped files, unreadable `.kdws`…), emitted by
  // the backend to this window only (`emit_to`).
  await listen("session-report", (e) => {
    showToast(e.payload.message, e.payload.error);
  });
}
