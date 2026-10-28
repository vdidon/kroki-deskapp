// @ts-check
// Log (« Journal ») dialog: diagnostic entries from the application and the
// plugins since launch (journal.rs — a single in-memory log for all windows).
// Opened unfiltered from the Info (« Informations ») dialog, filtered on a
// plugin from its card in the Plugins dialog. Each window keeps a copy
// kept up to date by `journal-entry`, which gives the Plugins dialog each
// plugin's entry count without an IPC round trip.

import { invoke, listen } from "./app.js";
import { allPlugins } from "./plugins.js";
import { onLocaleChange, t } from "./i18n.js";

/** @typedef {import("../../types/ipc").JournalEntry} JournalEntry */

// Static elements of ui/index.html.
const dialog = /** @type {HTMLDialogElement} */ (document.getElementById("journal-dialog"));
const filterEl = /** @type {HTMLSelectElement} */ (document.getElementById("journal-filter"));
const listEl = /** @type {HTMLDivElement} */ (document.getElementById("journal-list"));
const emptyEl = /** @type {HTMLParagraphElement} */ (document.getElementById("journal-empty"));
const copyBtn = /** @type {HTMLButtonElement} */ (document.getElementById("journal-copy"));

/** Same cap as `CAPACITY` (journal.rs). */
const CAPACITY = 500;

/** @type {JournalEntry[]} */
let entries = [];
let lastSeq = 0; // last entry received: discards a load/event duplicate
// Filter: "" = everything, "app" = the application alone, "plugin:<id>" = one plugin.
let filter = "";
/** @type {Set<() => void>} */
const subscribers = new Set();

/**
 * @param {JournalEntry} e
 * @returns {boolean}
 */
function matches(e) {
  if (!filter) return true;
  if (filter === "app") return !e.plugin;
  return e.plugin && filter === `plugin:${e.source}`;
}

/**
 * Number of entries of a plugin (the "Log" (« Journal ») button on its card).
 * @param {string} id
 * @returns {number}
 */
export function pluginEntryCount(id) {
  let n = 0;
  for (const e of entries) if (e.plugin && e.source === id) n++;
  return n;
}

/**
 * Called on every log change (entry received, reload).
 * @param {() => void} fn
 */
export function onJournalChange(fn) {
  subscribers.add(fn);
}

function notify() {
  for (const fn of subscribers) fn();
}

/**
 * @param {string} className
 * @param {string} text
 * @returns {HTMLSpanElement}
 */
function span(className, text) {
  const s = document.createElement("span");
  s.className = className;
  s.textContent = text;
  return s;
}

/**
 * @param {JournalEntry} e
 * @returns {HTMLDivElement}
 */
function renderRow(e) {
  const row = document.createElement("div");
  row.className = `journal-row ${e.level}`;
  row.append(
    span("journal-time", new Date(e.time).toLocaleTimeString()),
    // i18n-dynamic: journal.level.
    span("journal-level", t(`journal.level.${e.level}`)),
    span("journal-source", e.source),
    span("journal-msg", e.message),
  );
  return row;
}

// Filter options: everything, the application, then each plugin installed or
// present in the log (an uninstalled plugin no longer appears there, cf.
// `forget_plugin`, but an entry may precede the registry reload).
function renderFilter() {
  /** @type {Map<string, string>} */
  const names = new Map();
  for (const p of allPlugins()) names.set(p.id, p.name || p.id);
  for (const e of entries) if (e.plugin && !names.has(e.source)) names.set(e.source, e.source);
  if (filter.startsWith("plugin:") && !names.has(filter.slice(7))) names.set(filter.slice(7), filter.slice(7));
  /**
   * @param {string} value
   * @param {string} label
   */
  const option = (value, label) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    return o;
  };
  filterEl.replaceChildren(
    option("", t("journal.filter.all")),
    option("app", t("journal.filter.app")),
    ...[...names].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => option(`plugin:${id}`, name)),
  );
  filterEl.value = filter;
}

function renderList() {
  const shown = entries.filter(matches);
  listEl.replaceChildren(...shown.map(renderRow));
  emptyEl.hidden = shown.length > 0;
  listEl.hidden = !shown.length;
  listEl.scrollTop = listEl.scrollHeight;
}

/**
 * Opens the log; `pluginId` restricts it to that plugin right away.
 * @param {string} [pluginId]
 */
export function openJournal(pluginId) {
  filter = pluginId ? `plugin:${pluginId}` : "";
  copyBtn.textContent = t("journal.copy");
  renderFilter();
  dialog.showModal();
  renderList(); // after showModal: the scroller's height is known
}

/** @param {JournalEntry} e */
function line(e) {
  return `${new Date(e.time).toISOString()} ${e.level.toUpperCase()} [${e.source}] ${e.message}`;
}

async function copy() {
  try {
    await navigator.clipboard.writeText(entries.filter(matches).map(line).join("\n"));
    copyBtn.textContent = t("journal.copied");
  } catch (err) {
    copyBtn.textContent = String(err);
  }
}

async function reload() {
  /** @type {JournalEntry[]} */
  let fresh;
  try {
    fresh = await invoke("get_journal");
  } catch {
    fresh = [];
  }
  // Entries that arrived by event during the request: newer than the response,
  // they are added to it.
  const last = fresh.at(-1)?.seq ?? 0;
  entries = [...fresh, ...entries.filter((e) => e.seq > last)].slice(-CAPACITY);
  lastSeq = Math.max(lastSeq, last);
  if (dialog.open) {
    renderFilter();
    renderList();
  }
  notify();
}

/** @returns {Promise<void>} */
export async function initJournal() {
  /** @type {HTMLButtonElement} */ (document.getElementById("journal-close")).addEventListener(
    "click",
    () => dialog.close(),
  );
  copyBtn.addEventListener("click", copy);
  filterEl.addEventListener("change", () => {
    filter = filterEl.value;
    copyBtn.textContent = t("journal.copy");
    renderList();
  });
  onLocaleChange(() => {
    if (!dialog.open) return;
    copyBtn.textContent = t("journal.copy");
    renderFilter();
    renderList();
  });
  // Listener before the load: no entry lost in between, duplicates are
  // discarded by `seq`.
  await listen("journal-entry", ({ payload: e }) => {
    if (e.seq <= lastSeq) return;
    lastSeq = e.seq;
    entries.push(e);
    if (entries.length > CAPACITY) entries.shift();
    if (dialog.open) {
      if (e.plugin && ![...filterEl.options].some((o) => o.value === `plugin:${e.source}`)) renderFilter();
      if (matches(e)) {
        // Follows the bottom of the list only if we were already there.
        const atBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 24;
        listEl.append(renderRow(e));
        listEl.hidden = false;
        emptyEl.hidden = true;
        if (atBottom) listEl.scrollTop = listEl.scrollHeight;
      }
    }
    notify();
  });
  // Uninstall: the backend erased the plugin's entries.
  await listen("plugins-changed", () => reload());
  await reload();
}
