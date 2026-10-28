// Plugin protocol v1: messages exchanged between the host (main window,
// `ui/js/plugins.js`) and a plugin's worker (`kd` runtime,
// `ui/js/kd_runtime.js`). Normative reference: `doc/plugin-protocol.md` — the
// `§n` references below point to its sections. This file describes what
// the spec **and** the host code actually do; where they diverge, the
// field's comment says so.
//
// For a plugin author (JS + JSDoc, no bundler): the runtime exposes a
// `kd` global (§12) whose type is `KdApi`. In the plugin's repo, a local
// `.d.ts` is enough to type it:
//
//   import type { KdApi } from "<path>/types/plugin-protocol";
//   declare global { const kd: KdApi }
//
// then `kd.onRequest("document/transform", ({ text, title }) => …)` receives
// typed parameters and must return the expected `result`. Do not put this
// `declare global` in the application's `types/`: it would make `kd` a global
// of the main window, where it does not exist.
//
// Conventions:
// - Unknown fields are ignored on both sides (§5): a plugin may receive more
//   fields than described here, and the host ignores those it does not know in
//   a `result`.
// - Everything coming from the other side is **untrusted** until it has been
//   validated: on receipt, the host reads the raw envelope (`KdWireMessage`) and
//   trusts results only after validation (`pluginTransformDocument`,
//   `pluginRenderFence`, `pluginHighlight`).

import type { Anchor } from "./ipc";

// --- Envelope (§5) -------------------------------------------------------------

/**
 * Error codes (§5), extensible. `timeout` is never sent to the plugin:
 * the host detects it itself (§7.1) and kills the worker.
 */
export type KdErrorCode =
  | "internal"
  | "method-not-found"
  | "not-supported"
  | "timeout"
  | "denied"
  | "not-found"
  | (string & {});

export interface KdError {
  code: KdErrorCode;
  message: string;
}

/** Request (in both directions): `id` correlates the response, one id space per side. */
export interface KdRequest<M extends string = string, P = unknown> {
  kd: 1;
  id: number;
  method: M;
  params: P;
}

/** Response: exactly one of `result` / `error`. */
export type KdResponse<R = unknown> =
  | { kd: 1; id: number; result: R }
  | { kd: 1; id: number; error: KdError };

/** Notification: no `id`, never answered. */
export interface KdNotification<M extends string = string, P = unknown> {
  kd: 1;
  method: M;
  params?: P;
}

/**
 * Message as it arrives via `postMessage`, **before any validation**:
 * only the fields read by both sides are declared. The
 * `Record<string, unknown>` indexes let a property be read without trusting it
 * as typed — on a primitive or `null`, the optional read (`?.`) gives `undefined`.
 */
export interface KdWireMessage {
  kd?: unknown;
  id?: unknown;
  method?: unknown;
  params?: KdWireObject;
  result?: KdWireObject;
  error?: KdWireObject;
}

/**
 * Unvalidated received object (`params`, `result`, `error`): each property is
 * `unknown`. In v1 all these fields are objects; any other value reads
 * without error (`?.x` → `undefined`).
 */
export type KdWireObject = Readonly<Record<string, unknown>> | null | undefined;

// --- Common values -------------------------------------------------------------

/** **Effective** theme of the application, auto/light/dark setting already resolved (§12.2). */
export type KdTheme = "light" | "dark";

/** Capabilities (§4). `document:html` and `*:webview` are reserved, not served (§10). */
export type KdCapability =
  | "document:markdown"
  | "fence:svg"
  | "fence:html"
  | "fence:markdown"
  | "highlight:code"
  | "read:siblings"
  | "document:html"
  | "document:webview"
  | "fence:webview";

// --- Host → plugin: requests (§6.1 to §6.4) --------------------------------------

/** `initialize` (§6.1) — 10 s timeout, entry loading included. */
export interface InitializeParams {
  apiVersion: "1";
  /** `CARGO_PKG_VERSION`; empty string if the host could not read it. */
  hostVersion: string;
  /** What **this** host can serve. */
  capabilities: KdCapability[];
  theme: KdTheme;
  /** Interface language (since 3.25.0); absent from an older host = English. */
  locale: string;
}

/** The spec shows `{ ok: true }`; the host reads nothing from it (any non-error response counts as success). */
export interface InitializeResult {
  ok?: boolean;
}

/** `document/transform` (§6.2), capability `document:markdown` — 30 s timeout. */
export interface DocumentTransformParams {
  text: string;
  /** Absolute path of the document (cross-file deep links). */
  path: string;
  /** Document folder: base of `host/readFile`. */
  dir: string;
  /** File name without extension. */
  title: string;
  theme: KdTheme;
  locale: string;
}

export interface DocumentTransformResult {
  markdown: string;
  /** Sorted by markdown line; absent/invalid → `[[0, 0]]` (`sanitizeAnchors`). */
  anchors?: Anchor[];
  /** Displayed in a banner at the end of the document. */
  warnings?: string[];
}

/** `fence/render` (§6.3), capabilities `fence:svg|html|markdown` — 30 s timeout. */
export interface FenceRenderParams {
  lang: string;
  /** Block content; may be empty if `options.src`. */
  source: string;
  /** `key=value` pairs of the info string (`parseDiagramOptions`, render.js). */
  options: Record<string, string>;
  /** Document folder; empty string if unknown. */
  dir: string;
  theme: KdTheme;
  locale: string;
}

export interface FenceRenderResult {
  /** `svg` inserted as is, `html` sanitized by DOMPurify, `markdown` fed back through the pipeline. */
  format: "svg" | "html" | "markdown";
  content: string;
}

/**
 * `highlight/render` (§6.4), capability `highlight:code` — 5 s timeout. No
 * `theme`/`locale` here. For the "Source code" (« Code source ») view, `code`
 * is the whole document.
 */
export interface HighlightRenderParams {
  lang: string;
  code: string;
}

/** HTML `<span class="hljs-…">`; the host keeps only `span` + `class`. */
export interface HighlightRenderResult {
  html: string;
}

/** Host → plugin requests: method → `{ params, result }`. */
export interface HostToPluginRequests {
  initialize: { params: InitializeParams; result: InitializeResult };
  "document/transform": { params: DocumentTransformParams; result: DocumentTransformResult };
  "fence/render": { params: FenceRenderParams; result: FenceRenderResult };
  "highlight/render": { params: HighlightRenderParams; result: HighlightRenderResult };
}

// --- Host → plugin: notifications (§6.6) -----------------------------------------

/**
 * `shutdown` appears in §6.1 but the current host never sends it: it kills the
 * worker without notice (`PluginHost.stop`), which the spec also allows.
 */
export interface HostToPluginNotifications {
  "theme/changed": { theme: KdTheme };
  "locale/changed": { locale: string };
  shutdown: undefined;
}

// --- Plugin → host: services (§6.5) ----------------------------------------------

/**
 * `host/readFile`, capability `read:siblings`. Errors: `denied` (outside
 * confinement, outside the `siblingExtensions` allowlist, or outside the
 * handling of a request) / `not-found`.
 *
 * `dir`: the `dir` received with the current `document/transform`/`fence/render`
 * request — recommended. Optional: without it, the host takes the folder of the
 * only document being processed, and answers `denied` if requests
 * for several folders are in flight (§6.5).
 */
export interface HostReadFileParams {
  rel: string;
  dir?: string;
}

export interface HostReadFileResult {
  text: string;
}

/** Plugin → host requests. */
export interface PluginToHostRequests {
  "host/readFile": { params: HostReadFileParams; result: HostReadFileResult };
}

export type HostLogLevel = "debug" | "info" | "warn" | "error";

/** Plugin → host notifications. */
export interface PluginToHostNotifications {
  /** Application log ("Journal" / « Journal », §6.5): unknown `level` → `info`. */
  "host/log": { level: HostLogLevel; message: string };
}

/**
 * Internal signals of the `kd` runtime (outside the spec): end of the entry
 * import, successful or not. Awaited by the host before `initialize`.
 */
export interface RuntimeNotifications {
  "worker/ready": undefined;
  "worker/error": { message: string };
}

// --- The worker's `kd` global (§12) ------------------------------------------------

type Awaitable<T> = T | Promise<T>;

/** Handler of an incoming request: its return value becomes `result`, an exception becomes `error`. */
export type KdRequestHandler<M extends keyof HostToPluginRequests> = (
  params: HostToPluginRequests[M]["params"],
) => Awaitable<HostToPluginRequests[M]["result"]>;

/** Handler of an incoming notification: best effort, its exceptions are swallowed. */
export type KdNotificationHandler<M extends keyof HostToPluginNotifications> = (
  params: HostToPluginNotifications[M],
) => Awaitable<void>;

/**
 * Error thrown by `kd.request` when the host answers `error`; a handler may
 * also throw one to choose the returned `code` (default `internal`).
 */
export interface KdRequestError extends Error {
  code?: KdErrorCode;
}

/** API of the `kd` global, as seen by a plugin author. */
export interface KdApi {
  onRequest<M extends keyof HostToPluginRequests>(method: M, handler: KdRequestHandler<M>): void;
  onRequest<M extends keyof HostToPluginNotifications>(
    method: M,
    handler: KdNotificationHandler<M>,
  ): void;
  request<M extends keyof PluginToHostRequests>(
    method: M,
    params: PluginToHostRequests[M]["params"],
  ): Promise<PluginToHostRequests[M]["result"]>;
  notify<M extends keyof PluginToHostNotifications>(
    method: M,
    params: PluginToHostNotifications[M],
  ): void;
}

// --- Runtime side (kd_runtime.js) ---------------------------------------------------

/** Handler as stored by the runtime: it does not validate `params`, the host is the source. */
export type KdRawHandler = (params: unknown) => unknown;

/** Implementation of `kd` in the runtime: non-generic, plus `__load` (called by the blob). */
export interface KdRuntimeApi {
  onRequest(method: string, handler: KdRawHandler): void;
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  __load?(entryUrl: string): Promise<void>;
}

/**
 * The worker's `globalThis` as seen by the runtime. The project's TypeScript
 * config loads the `DOM` lib (windows) and not `WebWorker` — the two are
 * incompatible in the same program. `postMessage(msg)` and `self.onmessage`
 * already compile under `DOM` (overload `Window.postMessage(message, options?)`);
 * only `kd`, a property added to the global, needs this type, applied by cast to
 * `globalThis` in `kd_runtime.js` (no code added). The posted messages
 * are checked by `@satisfies KdOutgoingFromWorker`.
 */
export interface KdGlobal {
  kd: KdRuntimeApi;
}

/** Any message a worker may post to the host. */
export type KdOutgoingFromWorker =
  | KdRequest
  | KdResponse
  | KdNotification;

/** Any message the host may post to the worker. */
export type KdOutgoingFromHost =
  | KdRequest<keyof HostToPluginRequests>
  | KdResponse
  | KdNotification<keyof HostToPluginNotifications>;
