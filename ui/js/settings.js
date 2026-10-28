// @ts-check
// Settings (« Réglages »): theme, language, toolbar icons, optional external server,
// local Kroki API and update check, persisted on the Rust side.

import { invoke } from "./app.js";
import { applyTheme } from "./theme.js";
import { openPlugins } from "./plugins_ui.js";
import { ICON_GROUPS, applyIcons } from "./icons.js";
import { getLanguages, getLanguageSetting, loadLocale, onLocaleChange, t } from "./i18n.js";

/** @typedef {import("../../types/ipc").SettingsInfo} SettingsInfo */

// Elements from index.html, present by construction.
const dialog = /** @type {HTMLDialogElement} */ (document.getElementById("settings-dialog"));
const themeSelect = /** @type {HTMLSelectElement} */ (document.getElementById("theme-select"));
const languageSelect = /** @type {HTMLSelectElement} */ (document.getElementById("language-select"));
const iconsBox = /** @type {HTMLElement} */ (document.getElementById("icons-config"));
const urlInput = /** @type {HTMLInputElement} */ (document.getElementById("kroki-url"));
const serverEnabled = /** @type {HTMLInputElement} */ (document.getElementById("server-enabled"));
const serverPort = /** @type {HTMLInputElement} */ (document.getElementById("server-port"));
const supportedHint = /** @type {HTMLElement} */ (document.getElementById("supported-hint"));
const serverHint = /** @type {HTMLElement} */ (document.getElementById("server-hint"));
const updateCheck = /** @type {HTMLInputElement} */ (document.getElementById("update-check"));
const errorEl = /** @type {HTMLElement} */ (document.getElementById("settings-error"));

/** @type {(() => void) | null} */
let onSaved = null;
// Explicit choices being edited (id -> bool). A box never touched does not
// enter this object: it is therefore not saved and keeps following the
// registry default (cf. icons.js).
/** @type {Record<string, boolean>} */
let iconWork = {};
/** @type {Map<string, HTMLInputElement>} */
const iconBoxes = new Map(); // id -> <input type=checkbox>
// Last state received from `get_settings`: used to recompute the supported-types
// hint if the language changes while the dialog is open.
/** @type {SettingsInfo | null} */
let supportedInfo = null;

function updateServerHint() {
  serverHint.textContent = serverEnabled.checked
    ? t("settings.api.hint_on", { port: serverPort.value || 8442 })
    : t("settings.api.hint_off");
}

// `supported` comes from Rust (already in the current language); the sentences
// about missing Java and TeX are added here.
function updateSupportedHint() {
  if (!supportedInfo) return;
  supportedHint.textContent =
    supportedInfo.supported +
    (supportedInfo.java_available ? "" : ` ${t("settings.supported.no_java")}`) +
    (supportedInfo.tex_available ? "" : ` ${t("settings.supported.no_tex")}`);
}

// Shipped languages, under their endonym ("Français"): a language name is not
// translated, everyone must be able to recognize their own. The "auto" option
// comes from index.html (translated via data-i18n).
function buildLanguageUi() {
  const current = languageSelect.value;
  const auto = /** @type {HTMLOptionElement} */ (languageSelect.querySelector('option[value="auto"]'));
  const options = getLanguages().map(({ code, name }) => {
    const opt = document.createElement("option");
    opt.value = code;
    opt.lang = code;
    opt.textContent = name;
    return opt;
  });
  languageSelect.replaceChildren(auto, ...options);
  languageSelect.value = current;
}

// One checkbox per icon, with a preview cloned from the real button: the list
// cannot drift from the bar's visuals, and an icon added to index.html only has
// to be declared in the registry. Rebuilt on every language change (the
// registry labels are functions, resolved here).
function buildIconsUi() {
  iconBoxes.clear();
  const groups = ICON_GROUPS.map((group) => {
    const box = document.createElement("div");
    box.className = "icons-group";
    const title = document.createElement("div");
    title.className = "icons-group-title";
    title.textContent = group.title();
    const grid = document.createElement("div");
    grid.className = "icons-grid";
    for (const it of group.items) {
      const item = document.createElement("label");
      item.className = "icon-toggle";
      item.title =
        [it.hint?.(), it.locked ? t("icons.locked_hint") : ""].filter(Boolean).join(" · ") ||
        it.label();
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.icon = it.id;
      if (it.locked) {
        input.checked = true;
        input.disabled = true;
      } else {
        input.addEventListener("change", () => {
          iconWork[it.id] = input.checked;
        });
      }
      const preview = document.createElement("span");
      preview.className = "icon-preview";
      const svg = document.getElementById(it.id)?.querySelector("svg");
      if (svg) preview.appendChild(svg.cloneNode(true));
      const label = document.createElement("span");
      label.className = "icon-label";
      label.textContent = it.label();
      item.append(input, preview, label);
      if (!it.locked) iconBoxes.set(it.id, input);
      grid.appendChild(item);
    }
    box.append(title, grid);
    return box;
  });
  iconsBox.replaceChildren(...groups);
  syncIconBoxes(); // boxes on the defaults from init, before any opening
}

// Reflects `iconWork` (explicit choices) on top of the registry defaults.
function syncIconBoxes() {
  for (const group of ICON_GROUPS) {
    for (const it of group.items) {
      const input = iconBoxes.get(it.id);
      if (input) input.checked = iconWork[it.id] ?? it.def;
    }
  }
}

export async function openSettings() {
  const s = await invoke("get_settings");
  themeSelect.value = s.theme || "auto";
  languageSelect.value = s.language || "auto";
  iconWork = { ...(s.icons || {}) };
  syncIconBoxes();
  urlInput.value = s.external_url;
  serverEnabled.checked = s.server_enabled;
  serverPort.value = String(s.server_port);
  updateCheck.checked = s.update_check;
  supportedInfo = s;
  updateSupportedHint();
  updateServerHint();
  errorEl.hidden = true;
  dialog.showModal();
}

/** @param {() => void} savedCallback */
export function initSettings(savedCallback) {
  onSaved = savedCallback;

  buildLanguageUi();
  buildIconsUi();
  serverEnabled.addEventListener("change", updateServerHint);
  serverPort.addEventListener("input", updateServerHint);

  // Texts written by JS (icon labels, server hints, language names): to be
  // redone when the language changes. Choices being edited live in `iconWork`
  // and `languageSelect.value`, the rebuild keeps them.
  onLocaleChange(() => {
    buildLanguageUi();
    buildIconsUi();
    updateServerHint();
    updateSupportedHint();
  });

  // Plugin management: the Plugins dialog stacks above the Settings (« Réglages »)
  // one (nested modals, native to <dialog>).
  /** @type {HTMLElement} */ (document.getElementById("settings-plugins")).addEventListener("click", openPlugins);

  /** @type {HTMLElement} */ (document.getElementById("settings-reset")).addEventListener("click", () => {
    themeSelect.value = "auto";
    languageSelect.value = "auto";
    // Forget the icon choices: all go back to their default, and nothing is
    // saved until the user ticks something again.
    iconWork = {};
    syncIconBoxes();
    urlInput.value = "";
    serverEnabled.checked = true;
    serverPort.value = "8442";
    updateCheck.checked = true;
    updateServerHint();
  });
  /** @type {HTMLElement} */ (document.getElementById("settings-cancel")).addEventListener("click", () => {
    dialog.close();
  });
  /** @type {HTMLElement} */ (document.getElementById("settings-form")).addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await invoke("set_settings", {
        externalUrl: urlInput.value,
        serverEnabled: serverEnabled.checked,
        serverPort: Number(serverPort.value) || 8442,
        theme: themeSelect.value,
        language: languageSelect.value,
        icons: iconWork,
        updateCheck: updateCheck.checked,
      });
      // Language: reload the catalog BEFORE `onSaved`, whose re-render must
      // already produce messages in the new language. Also when the effective
      // language does not change: the raw setting (auto ↔ code) may have moved.
      if (languageSelect.value !== getLanguageSetting()) await loadLocale();
      // Immediate feedback on the originating window; the other windows receive
      // the `theme-changed` / `icons-changed` events (cf. main.js). `onSaved`
      // re-renders with the updated theme and re-evaluates the view actions.
      applyTheme(themeSelect.value);
      applyIcons(iconWork);
      dialog.close();
      onSaved?.();
    } catch (err) {
      errorEl.textContent = String(err);
      errorEl.hidden = false;
    }
  });
}
