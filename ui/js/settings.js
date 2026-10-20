// Réglages : thème, langue, icônes des barres d'outils, serveur externe optionnel,
// API Kroki locale et vérification des mises à jour, persistés côté Rust.

import { invoke } from "./app.js";
import { applyTheme } from "./theme.js";
import { openPlugins } from "./plugins_ui.js";
import { ICON_GROUPS, applyIcons } from "./icons.js";
import { getLanguages, getLanguageSetting, loadLocale, onLocaleChange, t } from "./i18n.js";

const dialog = document.getElementById("settings-dialog");
const themeSelect = document.getElementById("theme-select");
const languageSelect = document.getElementById("language-select");
const iconsBox = document.getElementById("icons-config");
const urlInput = document.getElementById("kroki-url");
const serverEnabled = document.getElementById("server-enabled");
const serverPort = document.getElementById("server-port");
const supportedHint = document.getElementById("supported-hint");
const serverHint = document.getElementById("server-hint");
const updateCheck = document.getElementById("update-check");
const errorEl = document.getElementById("settings-error");

let onSaved = null;
// Choix explicites en cours d'édition (id -> bool). Une case jamais touchée
// n'entre pas dans cet objet : elle n'est donc pas enregistrée et continue de
// suivre le défaut du registre (cf. icons.js).
let iconWork = {};
const iconBoxes = new Map(); // id -> <input type=checkbox>
// Dernier état reçu de `get_settings` : sert à recalculer l'indication des types
// pris en charge si la langue change pendant que le dialog est ouvert.
let supportedInfo = null;

function updateServerHint() {
  serverHint.textContent = serverEnabled.checked
    ? t("settings.api.hint_on", { port: serverPort.value || 8442 })
    : t("settings.api.hint_off");
}

// `supported` vient du Rust (déjà dans la langue courante) ; les phrases sur
// Java et TeX manquants sont ajoutées ici.
function updateSupportedHint() {
  if (!supportedInfo) return;
  supportedHint.textContent =
    supportedInfo.supported +
    (supportedInfo.java_available ? "" : ` ${t("settings.supported.no_java")}`) +
    (supportedInfo.tex_available ? "" : ` ${t("settings.supported.no_tex")}`);
}

// Langues livrées, sous leur endonyme (« Français ») : un nom de langue ne se
// traduit pas, chacun doit pouvoir reconnaître la sienne. L'option « auto »
// vient d'index.html (traduite par data-i18n).
function buildLanguageUi() {
  const current = languageSelect.value;
  const auto = languageSelect.querySelector('option[value="auto"]');
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

// Une case par icône, avec un aperçu cloné du bouton réel : la liste ne peut pas
// dériver du visuel de la barre, et une icône ajoutée à index.html n'a qu'à être
// déclarée dans le registre. Reconstruite à chaque changement de langue (les
// libellés du registre sont des fonctions, résolues ici).
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
  syncIconBoxes(); // cases sur les défauts dès l'init, avant toute ouverture
}

// Reflète `iconWork` (choix explicites) par-dessus les défauts du registre.
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
  serverPort.value = s.server_port;
  updateCheck.checked = s.update_check;
  supportedInfo = s;
  updateSupportedHint();
  updateServerHint();
  errorEl.hidden = true;
  dialog.showModal();
}

export function initSettings(savedCallback) {
  onSaved = savedCallback;

  buildLanguageUi();
  buildIconsUi();
  serverEnabled.addEventListener("change", updateServerHint);
  serverPort.addEventListener("input", updateServerHint);

  // Textes écrits par le JS (libellés des icônes, indications du serveur, noms
  // de langues) : à refaire quand la langue change. Les choix en cours d'édition
  // vivent dans `iconWork` et `languageSelect.value`, la reconstruction les garde.
  onLocaleChange(() => {
    buildLanguageUi();
    buildIconsUi();
    updateServerHint();
    updateSupportedHint();
  });

  // Gestion des plugins : le dialog Plugins s'empile au-dessus des Réglages
  // (modales imbriquées, native aux <dialog>).
  document.getElementById("settings-plugins").addEventListener("click", openPlugins);

  document.getElementById("settings-reset").addEventListener("click", () => {
    themeSelect.value = "auto";
    languageSelect.value = "auto";
    // Oublier les choix d'icônes : toutes repartent de leur défaut, et rien
    // n'est enregistré tant que l'utilisateur ne recoche pas quelque chose.
    iconWork = {};
    syncIconBoxes();
    urlInput.value = "";
    serverEnabled.checked = true;
    serverPort.value = 8442;
    updateCheck.checked = true;
    updateServerHint();
  });
  document.getElementById("settings-cancel").addEventListener("click", () => {
    dialog.close();
  });
  document.getElementById("settings-form").addEventListener("submit", async (e) => {
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
      // Langue : recharger le catalogue AVANT `onSaved`, dont le re-rendu doit
      // déjà produire les messages dans la nouvelle langue. Aussi quand la
      // langue effective ne change pas : le réglage brut (auto ↔ code) a pu bouger.
      if (languageSelect.value !== getLanguageSetting()) await loadLocale();
      // Feedback immédiat sur la fenêtre initiatrice ; les autres fenêtres reçoivent
      // les events `theme-changed` / `icons-changed` (cf. main.js). `onSaved`
      // re-rend avec le thème à jour et réévalue les actions de vue.
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
