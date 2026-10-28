// @ts-check
// Toolbar icons: registry, defaults, effective visibility.
//
// Global setting (persisted by the backend in `settings.json`) but
// **partial**: the map only contains the icons explicitly checked or
// unchecked by the user. Any absent icon follows the `def` below — a default
// that changed in a later version would therefore apply to the workstations
// that never touched it, without ever overwriting a choice made.
//
// The window bar's icons are hidden right here; those of the view action stack
// additionally depend on the displayed document (cf. `updateViewActions` in
// main.js), which queries `iconEnabled`.

import { t } from "./i18n.js";

// Labels, hints and group titles are functions: resolved at display time
// (Settings dialog, rebuilt on every language change), never frozen at import.
// `locked`: common hint (`icons.locked_hint`, added by settings.js).
/**
 * @typedef {object} IconItem
 * @property {string} id  button id in index.html
 * @property {() => string} label
 * @property {() => string} [hint]
 * @property {boolean} def
 * @property {boolean} [locked]
 *
 * @typedef {object} IconGroup
 * @property {() => string} title
 * @property {string | null} container
 * @property {IconItem[]} items
 */
/** @type {IconGroup[]} */
export const ICON_GROUPS = [
  {
    title: () => t("icons.group.window"),
    // The container whose buttons are driven directly by applyIcons.
    container: "tabbar-actions",
    items: [
      {
        id: "btn-open",
        label: () => t("icons.open.label"),
        hint: () => t("icons.open.hint"),
        def: true,
      },
      {
        id: "btn-save-session",
        label: () => t("icons.session.label"),
        hint: () => t("icons.session.hint"),
        def: true,
      },
      {
        id: "btn-search",
        label: () => t("icons.search.label"),
        hint: () => t("icons.search.hint"),
        def: true,
      },
      {
        id: "btn-refresh",
        label: () => t("icons.refresh.label"),
        hint: () => t("icons.refresh.hint"),
        def: true,
      },
      {
        id: "btn-new-window",
        label: () => t("icons.new_window.label"),
        hint: () => t("icons.new_window.hint"),
        def: true,
      },
      { id: "btn-info", label: () => t("icons.info.label"), def: true },
      { id: "btn-settings", label: () => t("icons.settings.label"), def: true, locked: true },
    ],
  },
  {
    title: () => t("icons.group.document"),
    // Floating stack: final visibility is decided in updateViewActions (an
    // enabled button stays hidden if the document does not suit it).
    container: null,
    items: [
      { id: "btn-toc", label: () => t("icons.toc.label"), def: true },
      {
        id: "btn-source-toggle",
        label: () => t("icons.source.label"),
        hint: () => t("icons.source.hint"),
        def: true,
      },
      {
        id: "btn-derived",
        label: () => t("icons.derived.label"),
        hint: () => t("icons.derived.hint"),
        def: false,
      },
      { id: "btn-fit-width", label: () => t("icons.fit_width.label"), def: true },
      {
        id: "btn-export",
        label: () => t("icons.export.label"),
        hint: () => t("icons.export.hint"),
        def: true,
      },
    ],
  },
];

const BY_ID = new Map(ICON_GROUPS.flatMap((g) => g.items.map((it) => [it.id, it])));

/** @type {Record<string, boolean>} */
let overrides = {}; // id -> bool, only the user's explicit choices

/**
 * Wanted visibility for an icon: explicit choice, otherwise the registry default.
 * @param {string} id
 * @returns {boolean}
 */
export function iconEnabled(id) {
  const it = BY_ID.get(id);
  if (!it) return true; // icon outside the registry: never hidden by this setting
  if (it.locked) return true;
  return overrides[id] ?? it.def;
}

/**
 * Applies a map of explicit choices: stores it, then hides/shows the buttons of
 * the bars with a fixed container. The view actions are re-evaluated by the
 * caller (updateViewActions), which alone knows the document's state.
 * @param {Record<string, boolean> | null | undefined} map
 */
export function applyIcons(map) {
  overrides = { ...(map || {}) };
  for (const group of ICON_GROUPS) {
    if (!group.container) continue;
    for (const it of group.items) {
      const el = document.getElementById(it.id);
      if (el) el.hidden = !iconEnabled(it.id);
    }
  }
}
