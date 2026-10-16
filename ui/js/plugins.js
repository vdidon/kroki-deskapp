// Hôte des plugins (protocole v1, doc/plugin-protocol.md).
//
// Chaque plugin actif tourne dans un **Web Worker sandboxé** : pas de DOM, pas
// d'`invoke`, pas de disque — uniquement des messages JSON avec cet hôte. Le
// worker est un blob (même origine, `worker-src blob:`) qui charge le runtime
// `kd` (ui/js/kd_runtime.js) puis importe l'entry du plugin via son URL
// absolue `plugin://` (CSP : `script-src … plugin: http://plugin.localhost`).
// Démarrage **paresseux** : au premier document/fence dont le plugin a la
// charge. Timeouts §7.1 : dépassement → worker tué, redémarrage paresseux ;
// 3 échecs consécutifs → plugin « en panne » jusqu'à réinstallation ou
// redémarrage de l'app.

import { invoke, listen, convertFileSrc } from "./app.js";
import { docIsDark } from "./theme.js";
import { sanitizeAnchors } from "./anchors.js";
import { t, getLocale, onLocaleChange } from "./i18n.js";

/// Capacités servables par cet hôte (négociation `initialize`, §6.1). Doit
/// rester en phase avec `HOST_CAPABILITIES` (src-tauri/src/plugins.rs).
const HOST_CAPABILITIES = [
  "document:markdown",
  "fence:svg",
  "fence:html",
  "fence:markdown",
  "highlight:code",
  "read:siblings",
];

// Extensions de documents gérées nativement — miroir de `DOC_EXTENSIONS`
// (manager.rs), pour le filtre du drag & drop JS (filedrop.js).
const NATIVE_DOC_EXTENSIONS = ["md", "markdown", "mdown", "mkd", "txt", "html", "htm"];

const TIMEOUTS = {
  initialize: 10000,
  "document/transform": 30000,
  "fence/render": 30000,
  "highlight/render": 5000,
};

let plugins = []; // liste backend (list_plugins), triée par ordre d'installation
const byExt = new Map(); // extension (sans point) -> PluginInfo
const byFence = new Map(); // langage de fence -> PluginInfo
const byHighlight = new Map(); // langage de coloration -> PluginInfo
const hosts = new Map(); // id -> PluginHost (workers vivants)
const broken = new Map(); // id -> raison (§7.1 : 3 échecs consécutifs)
const logs = new Map(); // id -> [{level, message}] (host/log, dialog d'info)

let runtimeSrcPromise = null; // texte de kd_runtime.js (chargé une fois)
let hostVersion = "";

// Base du protocole plugin : `http://plugin.localhost/` (Windows) ou
// `plugin://localhost/` (Linux). On n'utilise pas convertFileSrc directement
// pour le chemin complet : il percent-encode les `/`, ce qui casserait la
// résolution des imports relatifs du plugin (./tex.js).
const PLUGIN_BASE = convertFileSrc("", "plugin");

function pluginFileUrl(info, rel) {
  const path = String(rel).split("/").map(encodeURIComponent).join("/");
  return `${PLUGIN_BASE}${encodeURIComponent(info.id)}/${path}`;
}

function effectiveTheme() {
  return docIsDark() ? "dark" : "light";
}

function runtimeSource() {
  if (!runtimeSrcPromise) {
    runtimeSrcPromise = fetch("js/kd_runtime.js").then((r) => {
      if (!r.ok) throw new Error(`kd_runtime.js : HTTP ${r.status}`);
      return r.text();
    });
  }
  return runtimeSrcPromise;
}

function pushLog(id, level, message) {
  const buf = logs.get(id) || [];
  buf.push({ level, message: String(message) });
  if (buf.length > 200) buf.shift();
  logs.set(id, buf);
}

// --------------------------------------------------------------------------- //
// Worker d'un plugin : cycle de vie + corrélation requête/réponse
// --------------------------------------------------------------------------- //

class PluginHost {
  constructor(info) {
    this.info = info;
    this.worker = null;
    this.pending = new Map(); // id -> {resolve, reject, timer}
    this.nextId = 1;
    this.failures = 0; // échecs consécutifs (réinitialisé au 1er succès)
    this.startPromise = null;
    // Dossiers des documents en cours de traitement : `host/readFile` n'est
    // servi que pour eux (§6.5 — « valide pendant le traitement d'une requête »).
    this.activeDirs = new Map(); // dir -> compteur de requêtes en vol
  }

  ensure() {
    if (!this.startPromise) this.startPromise = this.start();
    return this.startPromise;
  }

  async start() {
    const runtime = await runtimeSource();
    const entryUrl = pluginFileUrl(this.info, this.info.entry);
    const blob = new Blob([runtime, `\nkd.__load(${JSON.stringify(entryUrl)});`], {
      type: "text/javascript",
    });
    const blobUrl = URL.createObjectURL(blob);
    try {
      this.worker = new Worker(blobUrl, { type: "module", name: `plugin:${this.info.id}` });
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
    this.worker.onmessage = (e) => this.onMessage(e.data);
    this.worker.onerror = (e) => this.abort(new Error(e?.message || t("runtime_ui.worker_error")));

    await new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      this.readyTimer = setTimeout(
        () => reject(new Error(t("runtime_ui.load_timeout"))),
        TIMEOUTS.initialize,
      );
    });
    await this.request("initialize", {
      apiVersion: "1",
      hostVersion,
      capabilities: HOST_CAPABILITIES,
      theme: effectiveTheme(),
      locale: getLocale(),
    });
  }

  onMessage(m) {
    if (!m || m.kd !== 1) return;
    if (m.method === "worker/ready") {
      clearTimeout(this.readyTimer);
      this.readyResolve?.();
      return;
    }
    if (m.method === "worker/error") {
      clearTimeout(this.readyTimer);
      this.readyReject?.(new Error(m.params?.message || t("runtime_ui.load_failed")));
      return;
    }
    if (m.id != null && ("result" in m || "error" in m)) {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if ("error" in m) {
        const err = new Error(m.error?.message || t("runtime_ui.plugin_error"));
        err.code = m.error?.code || "internal";
        err.remote = true; // erreur *retournée* par le plugin : pas une panne
        p.reject(err);
      } else {
        p.resolve(m.result);
      }
      return;
    }
    if (m.method) this.onRequest(m);
  }

  // Services de l'hôte (§6.5) — seuls points de sortie du sandbox.
  async onRequest(m) {
    const reply = (result, error) => {
      if (m.id != null) {
        this.worker?.postMessage({ kd: 1, id: m.id, ...(error ? { error } : { result }) });
      }
    };
    if (m.method === "host/log") {
      pushLog(this.info.id, m.params?.level || "info", m.params?.message || "");
      return;
    }
    if (m.method === "host/readFile") {
      const rel = String(m.params?.rel ?? "");
      const dir = String(m.params?.dir ?? "");
      if (!this.activeDirs.has(dir)) {
        reply(null, {
          code: "denied",
          message: t("runtime_ui.read_denied"),
        });
        return;
      }
      try {
        const text = await invoke("plugin_read_sibling", {
          pluginId: this.info.id,
          baseDir: dir,
          rel,
        });
        reply({ text });
      } catch (err) {
        // `{code, message}` (plugin_read_sibling) : le code ne dépend pas de la langue.
        reply(null, {
          code: err?.code === "not-found" ? "not-found" : "denied",
          message: String(err?.message ?? err),
        });
      }
      return;
    }
    reply(null, { code: "method-not-found", message: String(m.method) });
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error(t("runtime_ui.worker_stopped")));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error(t("runtime_ui.timeout", { method })), { timeout: true }));
      }, TIMEOUTS[method] ?? 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ kd: 1, id, method, params });
    });
  }

  notify(method, params) {
    this.worker?.postMessage({ kd: 1, method, params });
  }

  abort(err) {
    clearTimeout(this.readyTimer);
    this.readyReject?.(err);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.pending.clear();
    this.stop();
  }

  stop() {
    this.worker?.terminate();
    this.worker = null;
    this.startPromise = null;
    this.activeDirs.clear();
  }
}

// --------------------------------------------------------------------------- //
// Appels sortants : démarrage paresseux, comptage d'échecs, mise en panne
// --------------------------------------------------------------------------- //

async function call(info, method, params, dir) {
  if (broken.has(info.id)) {
    throw new Error(t("runtime_ui.broken", { id: info.id, reason: broken.get(info.id) }));
  }
  let host = hosts.get(info.id);
  if (!host) {
    host = new PluginHost(info);
    hosts.set(info.id, host);
  }
  try {
    await host.ensure();
    if (dir) host.activeDirs.set(dir, (host.activeDirs.get(dir) || 0) + 1);
    try {
      const result = await host.request(method, params);
      host.failures = 0;
      return result;
    } finally {
      if (dir) {
        const n = host.activeDirs.get(dir) || 0;
        if (n <= 1) host.activeDirs.delete(dir);
        else host.activeDirs.set(dir, n - 1);
      }
    }
  } catch (err) {
    // Une erreur *retournée* par le plugin (err.remote) est une réponse valide
    // du protocole : rendu dégradé, mais ni kill ni compteur de panne. Un
    // timeout/crash tue le worker (redémarrage paresseux, §7.1).
    if (!err?.remote) {
      host.failures += 1;
      host.abort(err instanceof Error ? err : new Error(String(err)));
      if (host.failures >= 3) {
        broken.set(info.id, String(err?.message || err));
        pushLog(info.id, "error", `plugin en panne : ${err?.message || err}`);
      }
    }
    throw err;
  }
}

// --------------------------------------------------------------------------- //
// Registre côté frontend
// --------------------------------------------------------------------------- //

function applyRegistry(list) {
  plugins = Array.isArray(list) ? list : [];
  // Versions potentiellement changées : on tue tous les workers (redémarrage
  // paresseux avec le nouveau code) et on lève les mises en panne.
  for (const h of hosts.values()) h.stop();
  hosts.clear();
  broken.clear();
  byExt.clear();
  byFence.clear();
  byHighlight.clear();
  // `plugins` est trié par ordre d'installation : le dernier écrase (§8.2).
  for (const p of plugins) {
    if (p.status !== "ok") continue;
    for (const e of p.extensions || []) byExt.set(e, p);
    for (const f of p.fences || []) byFence.set(f, p);
    for (const h of p.highlights || []) byHighlight.set(h, p);
  }
}

/**
 * Charge le registre et s'abonne aux changements (installation, suppression).
 * `onChange` re-rend les onglets ouverts (les revendications ont pu changer).
 */
export async function initPlugins(onChange) {
  try {
    hostVersion = await window.__TAURI__.app.getVersion();
  } catch {
    hostVersion = "";
  }
  applyRegistry(await invoke("list_plugins"));
  await listen("plugins-changed", (e) => {
    applyRegistry(e.payload);
    onChange?.();
  });
}

export function allPlugins() {
  return plugins;
}

function extOf(path) {
  const m = /\.([^.\\/]+)$/.exec(String(path || ""));
  return m ? m[1].toLowerCase() : "";
}

/** Plugin revendiquant l'extension de ce chemin (capacité `document:*`). */
export function documentPluginFor(path) {
  return byExt.get(extOf(path)) || null;
}

/** Plugin revendiquant ce langage de fence (le natif est arbitré en amont). */
export function fencePluginFor(lang) {
  return byFence.get(String(lang || "").toLowerCase()) || null;
}

/** Plugin revendiquant cette coloration (les grammaires hljs natives priment). */
export function highlightPluginFor(lang) {
  return byHighlight.get(String(lang || "").toLowerCase()) || null;
}

// Extensions natives dont la vue source a une grammaire hljs embarquée dans
// l'hôte (`.txt` n'en a pas, `.html` n'a pas de vue source du tout).
const NATIVE_SOURCE_LANGS = {
  md: "markdown",
  markdown: "markdown",
  mdown: "markdown",
  mkd: "markdown",
};

/**
 * Coloration de la **vue code source** d'un document : `{ lang, plugin }`, où
 * `plugin` null désigne une grammaire hljs de l'hôte. Null si personne ne sait
 * colorer ce format — la vue reste alors en texte brut.
 *
 * Pour un document servi par un plugin, on retient la première grammaire
 * revendiquée parmi `<ext>-source` puis `<ext>` : la convention `-source`
 * distingue la grammaire du **fichier entier** (déclarations comprises) de
 * celle des fences du même langage (cf. `latex` vs `latex-source`). Le plugin qui
 * sert l'extension est prioritaire ; à défaut, tout plugin revendiquant la
 * grammaire fait l'affaire (un plugin de coloration seule, §12).
 */
export function sourceHighlightFor(path) {
  const ext = extOf(path);
  const native = NATIVE_SOURCE_LANGS[ext];
  if (native) return { lang: native, plugin: null };
  const owner = byExt.get(ext);
  for (const lang of [`${ext}-source`, ext]) {
    if (owner && (owner.highlights || []).includes(lang)) return { lang, plugin: owner };
    const other = byHighlight.get(lang);
    if (other) return { lang, plugin: other };
  }
  return null;
}

/** Le chemin est-il un document ouvrable (extension native ou plugin) ? */
export function isOpenableDocPath(path) {
  const ext = extOf(path);
  return NATIVE_DOC_EXTENSIONS.includes(ext) || byExt.has(ext);
}

/** Le chemin est-il une archive de plugin `.kdext` ? */
export function isPluginArchivePath(path) {
  return extOf(path) === "kdext";
}

/** Le chemin est-il un fichier de session `.kdws` (miroir de `session.rs`) ? */
export function isSessionFilePath(path) {
  return extOf(path) === "kdws";
}

/** État runtime d'un plugin : « en panne » (§7.1) ou nominal. */
export function pluginRuntimeState(id) {
  return broken.has(id) ? { broken: true, reason: broken.get(id) } : { broken: false };
}

/** Journal `host/log` d'un plugin (dialog d'info runtimes). */
export function pluginLogs(id) {
  return logs.get(id) || [];
}

/** Notifie le thème effectif aux workers vivants (`theme/changed`, §6.6). */
export function notifyThemeChanged() {
  const theme = effectiveTheme();
  for (const h of hosts.values()) h.notify("theme/changed", { theme });
}

// Langue de l'interface changée (cette fenêtre ou une autre) : `locale/changed`
// (§6.6) aux workers vivants. Le re-rendu qui suit renvoie de toute façon
// `locale` dans chaque requête ; la notification sert aux caches du plugin.
onLocaleChange((locale) => {
  for (const h of hosts.values()) h.notify("locale/changed", { locale });
});

// --------------------------------------------------------------------------- //
// Méthodes du protocole (typées côté hôte, données plugin = non fiables)
// --------------------------------------------------------------------------- //

/** `document/transform` (§6.2) : source → { markdown, anchors, warnings }. */
export async function pluginTransformDocument(info, { text, path, dir, title }) {
  const r = await call(
    info,
    "document/transform",
    { text, path, dir, title, theme: effectiveTheme(), locale: getLocale() },
    dir,
  );
  return {
    markdown: String(r?.markdown ?? ""),
    anchors: sanitizeAnchors(r?.anchors),
    warnings: Array.isArray(r?.warnings) ? r.warnings.map(String) : [],
  };
}

/** `fence/render` (§6.3) : bloc fence → { format: "svg"|"html"|"markdown", content }. */
export async function pluginRenderFence(info, { lang, source, options, dir }) {
  const r = await call(
    info,
    "fence/render",
    { lang, source, options, dir, theme: effectiveTheme(), locale: getLocale() },
    dir,
  );
  const format = r?.format;
  if (format !== "svg" && format !== "html" && format !== "markdown") {
    throw new Error(t("runtime_ui.unexpected_format", { format: JSON.stringify(format) }));
  }
  return { format, content: String(r?.content ?? "") };
}

/** `highlight/render` (§6.4) : code → HTML `<span class="hljs-…">` (à sanitizer). */
export async function pluginHighlight(info, { lang, code }) {
  const r = await call(info, "highlight/render", { lang, code });
  return String(r?.html ?? "");
}

// --------------------------------------------------------------------------- //
// Rendu dégradé (§7.3) : le document reste lisible sans son plugin
// --------------------------------------------------------------------------- //

function fenceFor(source) {
  const longest = Math.max(2, ...[...String(source).matchAll(/`+/g)].map((m) => m[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * Markdown de secours quand le plugin d'un document est en panne ou en erreur :
 * bandeau explicatif + source intégral en fence. Ancres `[[0,0]]`.
 */
export function degradedDocMarkdown(title, reason, source) {
  const fence = fenceFor(source);
  return [
    `# ${title}`,
    "",
    `> ${t("runtime_ui.degraded", { reason: String(reason?.message || reason) })}`,
    "",
    fence,
    source,
    fence,
    "",
  ].join("\n");
}
