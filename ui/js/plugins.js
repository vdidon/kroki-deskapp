// @ts-check
// Plugin host (protocol v1, doc/plugin-protocol.md).
//
// Each active plugin runs in a **sandboxed Web Worker**: no DOM, no
// `invoke`, no disk — only JSON messages with this host. The
// worker is a blob (same origin, `worker-src blob:`) that loads the `kd`
// runtime (ui/js/kd_runtime.js) then imports the plugin entry via its
// absolute `plugin://` URL (CSP: `script-src … plugin: http://plugin.localhost`).
// **Lazy** start: at the first document/fence the plugin is in charge of.
// Timeouts §7.1: exceeded → worker killed, lazy restart;
// 3 consecutive failures → plugin « en panne » (broken) until reinstall or
// app restart.

import { invoke, listen, convertFileSrc } from "./app.js";
import { docIsDark } from "./theme.js";
import { sanitizeAnchors } from "./anchors.js";
import { t, getLocale, onLocaleChange } from "./i18n.js";

/** @typedef {import("../../types/ipc").PluginInfo} PluginInfo */
/** @typedef {import("../../types/ipc").Anchor} Anchor */
/** @typedef {import("../../types/ipc").SiblingError} SiblingError */
/** @typedef {import("../../types/plugin-protocol").KdCapability} KdCapability */
/** @typedef {import("../../types/plugin-protocol").KdTheme} KdTheme */
/** @typedef {import("../../types/plugin-protocol").KdError} KdError */
/** @typedef {import("../../types/plugin-protocol").KdWireMessage} KdWireMessage */
/** @typedef {import("../../types/plugin-protocol").KdWireObject} KdWireObject */
/** @typedef {import("../../types/plugin-protocol").KdOutgoingFromHost} KdOutgoingFromHost */
/** @typedef {import("../../types/plugin-protocol").HostToPluginRequests} HostToPluginRequests */
/** @typedef {import("../../types/plugin-protocol").HostToPluginNotifications} HostToPluginNotifications */
/** @typedef {import("../../types/plugin-protocol").FenceRenderResult} FenceRenderResult */

/**
 * Error from a plugin call: `remote` = error *returned* by the plugin
 * (`code` = its `error.code`, unvalidated), `timeout` = §7.1 deadline exceeded.
 * @typedef {Error & { code?: unknown, remote?: boolean, timeout?: boolean }} PluginCallError
 */

/**
 * Host → plugin request awaiting a reply.
 * @typedef {object} PendingRequest
 * @property {(value: KdWireObject) => void} resolve
 * @property {(reason: Error) => void} reject
 * @property {ReturnType<typeof setTimeout>} timer
 */

/// Capabilities this host can serve (`initialize` negotiation, §6.1). Must
/// stay in sync with `HOST_CAPABILITIES` (src-tauri/src/plugins.rs).
/** @type {KdCapability[]} */
const HOST_CAPABILITIES = [
  "document:markdown",
  "fence:svg",
  "fence:html",
  "fence:markdown",
  "highlight:code",
  "read:siblings",
];

// Natively handled document extensions — mirror of `DOC_EXTENSIONS`
// (manager.rs), for the JS drag & drop filter (filedrop.js).
const NATIVE_DOC_EXTENSIONS = ["md", "markdown", "mdown", "mkd", "txt", "html", "htm"];

/** @type {Readonly<Record<keyof HostToPluginRequests, number>>} */
const TIMEOUTS = {
  initialize: 10000,
  "document/transform": 30000,
  "fence/render": 30000,
  "highlight/render": 5000,
};

/** @type {PluginInfo[]} */
let plugins = []; // backend list (list_plugins), sorted by install order
/** @type {Map<string, PluginInfo>} */
const byExt = new Map(); // extension (no dot) -> PluginInfo
/** @type {Map<string, PluginInfo>} */
const byFence = new Map(); // fence language -> PluginInfo
/** @type {Map<string, PluginInfo>} */
const byHighlight = new Map(); // highlighting language -> PluginInfo
/** @type {Map<string, PluginHost>} */
const hosts = new Map(); // id -> PluginHost (live workers)
/** @type {Map<string, string>} */
const broken = new Map(); // id -> reason (§7.1: 3 consecutive failures)
// Per-plugin log rate: beyond LOG_BURST entries per second, the following
// ones are counted then summarized in a single one (a plugin that logs
// in a loop must not flood the IPC nor evict the rest of the log).
const LOG_BURST = 20;
/** @type {Map<string, { start: number, count: number, dropped: number }>} */
const logRate = new Map();

/** @type {Promise<string> | null} */
let runtimeSrcPromise = null; // text of kd_runtime.js (loaded once)
let hostVersion = "";

// Base of the plugin protocol: `http://plugin.localhost/` (Windows) or
// `plugin://localhost/` (Linux). We don't use convertFileSrc directly
// for the full path: it percent-encodes the `/`, which would break
// the resolution of the plugin's relative imports (./tex.js).
const PLUGIN_BASE = convertFileSrc("", "plugin");

/**
 * @param {PluginInfo} info
 * @param {string} rel
 * @returns {string}
 */
function pluginFileUrl(info, rel) {
  const path = String(rel).split("/").map(encodeURIComponent).join("/");
  return `${PLUGIN_BASE}${encodeURIComponent(info.id)}/${path}`;
}

/** @returns {KdTheme} */
function effectiveTheme() {
  return docIsDark() ? "dark" : "light";
}

/** @returns {Promise<string>} */
function runtimeSource() {
  if (!runtimeSrcPromise) {
    runtimeSrcPromise = fetch("js/kd_runtime.js").then((r) => {
      if (!r.ok) throw new Error(`kd_runtime.js : HTTP ${r.status}`);
      return r.text();
    });
  }
  return runtimeSrcPromise;
}

/**
 * Application log entry for this plugin (journal.rs): its
 * `host/log`, or a failure seen by the host. The backend validates `level`, truncates the
 * message and broadcasts the entry to all windows.
 * @param {string} id
 * @param {unknown} level unvalidated (`host/log`)
 * @param {unknown} message
 */
function pushLog(id, level, message) {
  const now = Date.now();
  let rate = logRate.get(id);
  if (!rate || now - rate.start >= 1000) {
    const dropped = rate?.dropped ?? 0;
    rate = { start: now, count: 0, dropped: 0 };
    logRate.set(id, rate);
    if (dropped) {
      rate.count++;
      invoke("plugin_log", {
        pluginId: id,
        level: "warn",
        message: t("journal.dropped", { count: dropped }),
      }).catch(() => {});
    }
  }
  if (rate.count >= LOG_BURST) {
    rate.dropped++;
    return;
  }
  rate.count++;
  invoke("plugin_log", {
    pluginId: id,
    level: String(level),
    message: String(message),
  }).catch(() => {});
}

// --------------------------------------------------------------------------- //
// A plugin's worker: lifecycle + request/reply correlation
// --------------------------------------------------------------------------- //

class PluginHost {
  /** @param {PluginInfo} info */
  constructor(info) {
    this.info = info;
    /** @type {Worker | null} */
    this.worker = null;
    /** @type {Map<number, PendingRequest>} */
    this.pending = new Map(); // id -> {resolve, reject, timer}
    this.nextId = 1;
    this.failures = 0; // consecutive failures (reset on first success)
    /** @type {Promise<void> | null} */
    this.startPromise = null;
    // Folders of the documents being processed: `host/readFile` is only
    // served for them (§6.5 — "valid while a request is being processed").
    /** @type {Map<string, number>} */
    this.activeDirs = new Map(); // dir -> in-flight request counter
  }

  /** @returns {Promise<void>} */
  ensure() {
    if (!this.startPromise) this.startPromise = this.start();
    return this.startPromise;
  }

  /** @returns {Promise<void>} */
  async start() {
    const t0 = performance.now();
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
      /** @type {((value?: unknown) => void) | undefined} */
      this.readyResolve = resolve;
      /** @type {((reason: Error) => void) | undefined} */
      this.readyReject = reject;
      /** @type {ReturnType<typeof setTimeout> | undefined} */
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
    pushLog(
      this.info.id,
      "info",
      `worker started (v${this.info.version}) in ${Math.round(performance.now() - t0)} ms`,
    );
  }

  /** @param {KdWireMessage | null | undefined} m worker message, unvalidated */
  onMessage(m) {
    if (!m || m.kd !== 1) return;
    if (m.method === "worker/ready") {
      clearTimeout(this.readyTimer);
      this.readyResolve?.();
      return;
    }
    if (m.method === "worker/error") {
      clearTimeout(this.readyTimer);
      // `Error()` converts a non-string message.
      this.readyReject?.(
        new Error(/** @type {string | undefined} */ (m.params?.message) || t("runtime_ui.load_failed")),
      );
      return;
    }
    if (m.id != null && ("result" in m || "error" in m)) {
      // A non-numeric `id` matches no pending request.
      const p = this.pending.get(/** @type {number} */ (m.id));
      if (!p) return;
      this.pending.delete(/** @type {number} */ (m.id));
      clearTimeout(p.timer);
      if ("error" in m) {
        const err = /** @type {PluginCallError} */ (
          new Error(/** @type {string | undefined} */ (m.error?.message) || t("runtime_ui.plugin_error"))
        );
        err.code = m.error?.code || "internal";
        err.remote = true; // error *returned* by the plugin: not a breakdown
        p.reject(err);
      } else {
        p.resolve(m.result);
      }
      return;
    }
    if (m.method) this.onRequest(m);
  }

  // Host services (§6.5) — the sandbox's only exit points.
  /** @param {KdWireMessage} m worker request or notification, unvalidated */
  async onRequest(m) {
    /**
     * @param {unknown} result
     * @param {KdError} [error]
     */
    const reply = (result, error) => {
      if (m.id != null) {
        // `id` sent back as received: correlation is the worker's business.
        this.worker?.postMessage(
          /** @satisfies {KdOutgoingFromHost} */ ({
            kd: 1,
            id: /** @type {number} */ (m.id),
            ...(error ? { error } : { result }),
          }),
        );
      }
    };
    if (m.method === "host/log") {
      pushLog(this.info.id, m.params?.level || "info", m.params?.message || "");
      return;
    }
    if (m.method === "host/readFile") {
      const rel = String(m.params?.rel ?? "");
      // `dir` optional (§6.5): without it, the folder of the only document
      // being processed; ambiguous if several are in flight → `denied`.
      const dir =
        String(m.params?.dir ?? "") ||
        (this.activeDirs.size === 1 ? this.activeDirs.keys().next().value ?? "" : "");
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
        // `{code, message}` (plugin_read_sibling): the code is language-independent.
        // An upstream IPC error (string) gives `denied` and its text.
        reply(null, {
          code:
            /** @type {Partial<SiblingError> | null} */ (err)?.code === "not-found" ? "not-found" : "denied",
          message: String(/** @type {Partial<SiblingError> | null} */ (err)?.message ?? err),
        });
      }
      return;
    }
    reply(null, { code: "method-not-found", message: String(m.method) });
  }

  /**
   * Host → plugin request; the result is **unvalidated**.
   * @template {keyof HostToPluginRequests} M
   * @param {M} method
   * @param {HostToPluginRequests[M]["params"]} params
   * @returns {Promise<KdWireObject>}
   */
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
      this.worker.postMessage(/** @satisfies {KdOutgoingFromHost} */ ({ kd: 1, id, method, params }));
    });
  }

  /**
   * @template {keyof HostToPluginNotifications} M
   * @param {M} method
   * @param {HostToPluginNotifications[M]} params
   */
  notify(method, params) {
    this.worker?.postMessage(/** @satisfies {KdOutgoingFromHost} */ ({ kd: 1, method, params }));
  }

  /** @param {Error} err */
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
// Outgoing calls: lazy start, failure counting, breakdown
// --------------------------------------------------------------------------- //

/**
 * @template {keyof HostToPluginRequests} M
 * @param {PluginInfo} info
 * @param {M} method
 * @param {HostToPluginRequests[M]["params"]} params
 * @param {string} [dir] folder opened to `host/readFile` for the duration of the call
 * @returns {Promise<KdWireObject>} unvalidated result
 */
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
    // An error *returned* by the plugin (err.remote) is a valid protocol
    // reply: degraded rendering, but neither kill nor failure counter. A
    // timeout/crash kills the worker (lazy restart, §7.1).
    // `err`: PluginCallError, or any value thrown upstream (start, invoke).
    const reason = String(/** @type {Partial<Error> | null} */ (err)?.message || err);
    if (/** @type {Partial<PluginCallError> | null} */ (err)?.remote) {
      pushLog(info.id, "warn", `${method}: ${reason}`);
    } else {
      host.failures += 1;
      host.abort(err instanceof Error ? err : new Error(String(err)));
      pushLog(info.id, "error", `${method}: ${reason}`);
      if (host.failures >= 3) {
        broken.set(info.id, reason);
        pushLog(info.id, "error", t("runtime_ui.broken", { id: info.id, reason }));
      }
    }
    throw err;
  }
}

// --------------------------------------------------------------------------- //
// Frontend-side registry
// --------------------------------------------------------------------------- //

/** @param {PluginInfo[]} list */
function applyRegistry(list) {
  plugins = Array.isArray(list) ? list : [];
  // Versions may have changed: kill all workers (lazy restart with the
  // new code) and clear the breakdowns.
  for (const h of hosts.values()) h.stop();
  hosts.clear();
  broken.clear();
  byExt.clear();
  byFence.clear();
  byHighlight.clear();
  // `plugins` is sorted by install order: the last one wins (§8.2).
  for (const p of plugins) {
    if (p.status !== "ok") continue;
    for (const e of p.extensions || []) byExt.set(e, p);
    for (const f of p.fences || []) byFence.set(f, p);
    for (const h of p.highlights || []) byHighlight.set(h, p);
  }
}

/**
 * Loads the registry and subscribes to changes (install, removal).
 * `onChange` re-renders the open tabs (the claims may have changed).
 * @param {() => void} [onChange]
 * @returns {Promise<void>}
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

/** @returns {PluginInfo[]} */
export function allPlugins() {
  return plugins;
}

/**
 * @param {string | null | undefined} path
 * @returns {string}
 */
function extOf(path) {
  const m = /\.([^.\\/]+)$/.exec(String(path || ""));
  return m ? m[1].toLowerCase() : "";
}

/**
 * Plugin claiming this path's extension (`document:*` capability).
 * @param {string | null | undefined} path
 * @returns {PluginInfo | null}
 */
export function documentPluginFor(path) {
  return byExt.get(extOf(path)) || null;
}

/**
 * Plugin claiming this fence language (native precedence is settled upstream).
 * @param {string | null | undefined} lang
 * @returns {PluginInfo | null}
 */
export function fencePluginFor(lang) {
  return byFence.get(String(lang || "").toLowerCase()) || null;
}

/**
 * Plugin claiming this highlighting (native hljs grammars take precedence).
 * @param {string | null | undefined} lang
 * @returns {PluginInfo | null}
 */
export function highlightPluginFor(lang) {
  return byHighlight.get(String(lang || "").toLowerCase()) || null;
}

// Native extensions whose source view has an hljs grammar embedded in
// the host (`.txt` has none, `.html` has no source view at all).
// Null prototype: the extension comes from a file name, `x.constructor` must
// not find Object.prototype.constructor there.
/** @type {Record<string, string | undefined>} */
const NATIVE_SOURCE_LANGS = Object.assign(Object.create(null), {
  md: "markdown",
  markdown: "markdown",
  mdown: "markdown",
  mkd: "markdown",
});

/**
 * Highlighting of a document's **source code view**: `{ lang, plugin }`, where
 * a null `plugin` means a host hljs grammar. Null if nobody can highlight
 * this format — the view then stays plain text.
 *
 * For a document served by a plugin, we keep the first claimed grammar among
 * `<ext>-source` then `<ext>`: the `-source` convention distinguishes the
 * grammar of the **whole file** (declarations included) from that of the
 * same language's fences (cf. `latex` vs `latex-source`). The plugin that
 * serves the extension has priority; failing that, any plugin claiming the
 * grammar will do (a highlighting-only plugin, §12).
 * @param {string | null | undefined} path
 * @returns {SourceHighlight | null}
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

/**
 * Source view grammar: null `plugin` = host hljs grammar.
 * @typedef {{ lang: string, plugin: PluginInfo | null }} SourceHighlight
 */

/**
 * Is the path an openable document (native or plugin extension)?
 * @param {string | null | undefined} path
 * @returns {boolean}
 */
export function isOpenableDocPath(path) {
  const ext = extOf(path);
  return NATIVE_DOC_EXTENSIONS.includes(ext) || byExt.has(ext);
}

/**
 * Is the path a `.kdext` plugin archive?
 * @param {string | null | undefined} path
 * @returns {boolean}
 */
export function isPluginArchivePath(path) {
  return extOf(path) === "kdext";
}

/**
 * Is the path a `.kdws` session file (mirror of `session.rs`)?
 * @param {string | null | undefined} path
 * @returns {boolean}
 */
export function isSessionFilePath(path) {
  return extOf(path) === "kdws";
}

/**
 * Runtime state of a plugin: « en panne » (broken, §7.1) or nominal.
 * @param {string} id
 * @returns {{ broken: boolean, reason?: string }}
 */
export function pluginRuntimeState(id) {
  return broken.has(id) ? { broken: true, reason: broken.get(id) } : { broken: false };
}

/** Notifies the effective theme to live workers (`theme/changed`, §6.6). */
export function notifyThemeChanged() {
  const theme = effectiveTheme();
  for (const h of hosts.values()) h.notify("theme/changed", { theme });
}

// Interface language changed (this window or another): `locale/changed`
// (§6.6) to live workers. The re-render that follows sends `locale` in every
// request anyway; the notification is for the plugin's caches.
onLocaleChange((locale) => {
  for (const h of hosts.values()) h.notify("locale/changed", { locale });
});

// --------------------------------------------------------------------------- //
// Protocol methods (typed on the host side, plugin data = untrusted)
// --------------------------------------------------------------------------- //

/**
 * `document/transform` (§6.2) : source → { markdown, anchors, warnings }.
 * Validated result: strings coerced, anchors sanitized.
 * @param {PluginInfo} info
 * @param {{ text: string, path: string, dir: string, title: string }} doc
 * @returns {Promise<{ markdown: string, anchors: Anchor[], warnings: string[] }>}
 */
export async function pluginTransformDocument(info, { text, path, dir, title }) {
  const t0 = performance.now();
  const r = await call(
    info,
    "document/transform",
    { text, path, dir, title, theme: effectiveTheme(), locale: getLocale() },
    dir,
  );
  const doc = {
    markdown: String(r?.markdown ?? ""),
    anchors: sanitizeAnchors(r?.anchors),
    warnings: Array.isArray(r?.warnings) ? r.warnings.map(String) : [],
  };
  // Plugin-only time (excluding the host's markdown render, cf. loading.js):
  // tells a plugin slowdown from a host one. Worker start-up included on the 1st call.
  const name = String(path).split(/[\\/]/).pop();
  const warns = doc.warnings.length ? `, ${doc.warnings.length} warning(s)` : "";
  pushLog(
    info.id,
    "info",
    `document/transform ${name}: ${Math.round(performance.now() - t0)} ms, ` +
      `${Math.round(text.length / 1024)}k → ${Math.round(doc.markdown.length / 1024)}k chars${warns}`,
  );
  return doc;
}

/**
 * `fence/render` (§6.3) : bloc fence → { format: "svg"|"html"|"markdown", content }.
 * Validated result: format outside the list → exception.
 * @param {PluginInfo} info
 * @param {{ lang: string, source: string, options: Record<string, string>, dir: string }} fence
 * @returns {Promise<FenceRenderResult>}
 */
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

/**
 * `highlight/render` (§6.4): code → HTML `<span class="hljs-…">` (to be sanitized).
 * @param {PluginInfo} info
 * @param {{ lang: string, code: string }} req
 * @returns {Promise<string>}
 */
export async function pluginHighlight(info, { lang, code }) {
  const r = await call(info, "highlight/render", { lang, code });
  return String(r?.html ?? "");
}

// --------------------------------------------------------------------------- //
// Degraded rendering (§7.3): the document stays readable without its plugin
// --------------------------------------------------------------------------- //

/**
 * @param {string} source
 * @returns {string}
 */
function fenceFor(source) {
  const longest = Math.max(2, ...[...String(source).matchAll(/`+/g)].map((m) => m[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}

/**
 * Fallback markdown when a document's plugin is broken or erroring:
 * explanatory banner + full source in a fence. Anchors `[[0,0]]`.
 * @param {string} title
 * @param {unknown} reason thrown error (its `message`) or text
 * @param {string} source
 * @returns {string}
 */
export function degradedDocMarkdown(title, reason, source) {
  const fence = fenceFor(source);
  return [
    `# ${title}`,
    "",
    `> ${t("runtime_ui.degraded", {
      reason: String(/** @type {Partial<Error> | null} */ (reason)?.message || reason),
    })}`,
    "",
    fence,
    source,
    fence,
    "",
  ].join("\n");
}
