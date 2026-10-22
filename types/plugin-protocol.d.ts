// Protocole de plugins v1 : messages échangés entre l'hôte (fenêtre principale,
// `ui/js/plugins.js`) et le worker d'un plugin (runtime `kd`,
// `ui/js/kd_runtime.js`). Référence normative : `doc/plugin-protocol.md` — les
// renvois `§n` ci-dessous pointent vers ses sections. Ce fichier décrit ce que
// la spec **et** le code de l'hôte font réellement ; quand ils divergent, le
// commentaire du champ le dit.
//
// Pour un auteur de plugin (JS + JSDoc, sans bundler) : le runtime expose un
// global `kd` (§12) dont `KdApi` est le type. Dans le dépôt du plugin, un
// `.d.ts` local suffit pour le typer :
//
//   import type { KdApi } from "<chemin>/types/plugin-protocol";
//   declare global { const kd: KdApi }
//
// puis `kd.onRequest("document/transform", ({ text, title }) => …)` reçoit des
// paramètres typés et doit retourner le `result` attendu. Ne pas mettre ce
// `declare global` dans `types/` de l'application : il ferait de `kd` un global
// de la fenêtre principale, où il n'existe pas.
//
// Conventions :
// - Champs inconnus ignorés des deux côtés (§5) : un plugin peut recevoir plus
//   de champs que décrit ici, et l'hôte ignore ceux qu'il ne connaît pas dans
//   un `result`.
// - Tout ce qui vient de l'autre bord est **non fiable** tant qu'il n'a pas été
//   validé : à la réception, l'hôte lit l'enveloppe brute (`KdWireMessage`) et
//   ne fait confiance aux résultats qu'après validation (`pluginTransformDocument`,
//   `pluginRenderFence`, `pluginHighlight`).

import type { Anchor } from "./ipc";

// --- Enveloppe (§5) ------------------------------------------------------------

/**
 * Codes d'erreur (§5), extensibles. `timeout` n'est jamais envoyé au plugin :
 * l'hôte le constate lui-même (§7.1) et tue le worker.
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

/** Requête (dans les deux sens) : `id` corrèle la réponse, un espace d'id par côté. */
export interface KdRequest<M extends string = string, P = unknown> {
  kd: 1;
  id: number;
  method: M;
  params: P;
}

/** Réponse : exactement l'un de `result` / `error`. */
export type KdResponse<R = unknown> =
  | { kd: 1; id: number; result: R }
  | { kd: 1; id: number; error: KdError };

/** Notification : pas d'`id`, jamais de réponse. */
export interface KdNotification<M extends string = string, P = unknown> {
  kd: 1;
  method: M;
  params?: P;
}

/**
 * Message tel qu'il arrive par `postMessage`, **avant toute validation** :
 * seuls les champs lus par les deux bords sont déclarés. Les index
 * `Record<string, unknown>` laissent lire une propriété sans la croire typée —
 * sur une primitive ou `null` la lecture optionnelle (`?.`) donne `undefined`.
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
 * Objet reçu non validé (`params`, `result`, `error`) : chaque propriété est
 * `unknown`. En v1 tous ces champs sont des objets ; une autre valeur se lit
 * sans erreur (`?.x` → `undefined`).
 */
export type KdWireObject = Readonly<Record<string, unknown>> | null | undefined;

// --- Valeurs communes ----------------------------------------------------------

/** Thème **effectif** de l'application, réglage auto/clair/sombre déjà résolu (§12.2). */
export type KdTheme = "light" | "dark";

/** Capacités (§4). `document:html` et `*:webview` sont réservées, non servies (§10). */
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

// --- Hôte → plugin : requêtes (§6.1 à §6.4) -------------------------------------

/** `initialize` (§6.1) — délai 10 s, chargement de l'entry compris. */
export interface InitializeParams {
  apiVersion: "1";
  /** `CARGO_PKG_VERSION` ; chaîne vide si l'hôte n'a pas pu la lire. */
  hostVersion: string;
  /** Ce que **cet** hôte sait servir. */
  capabilities: KdCapability[];
  theme: KdTheme;
  /** Langue de l'interface (depuis 3.25.0) ; absente d'un hôte plus ancien = anglais. */
  locale: string;
}

/** La spec montre `{ ok: true }` ; l'hôte n'en lit rien (toute réponse non-erreur vaut succès). */
export interface InitializeResult {
  ok?: boolean;
}

/** `document/transform` (§6.2), capacité `document:markdown` — délai 30 s. */
export interface DocumentTransformParams {
  text: string;
  /** Chemin absolu du document (deep links inter-fichiers). */
  path: string;
  /** Dossier du document : base de `host/readFile`. */
  dir: string;
  /** Nom du fichier sans extension. */
  title: string;
  theme: KdTheme;
  locale: string;
}

export interface DocumentTransformResult {
  markdown: string;
  /** Triées par ligne markdown ; absentes/invalides → `[[0, 0]]` (`sanitizeAnchors`). */
  anchors?: Anchor[];
  /** Affichés dans un bandeau en fin de document. */
  warnings?: string[];
}

/** `fence/render` (§6.3), capacités `fence:svg|html|markdown` — délai 30 s. */
export interface FenceRenderParams {
  lang: string;
  /** Contenu du bloc ; peut être vide si `options.src`. */
  source: string;
  /** Paires `clé=valeur` de l'info string (`parseDiagramOptions`, render.js). */
  options: Record<string, string>;
  /** Dossier du document ; chaîne vide s'il est inconnu. */
  dir: string;
  theme: KdTheme;
  locale: string;
}

export interface FenceRenderResult {
  /** `svg` inséré tel quel, `html` assaini par DOMPurify, `markdown` repassé dans le pipeline. */
  format: "svg" | "html" | "markdown";
  content: string;
}

/**
 * `highlight/render` (§6.4), capacité `highlight:code` — délai 5 s. Pas de
 * `theme`/`locale` ici. Pour la vue « Code source », `code` est le document
 * entier.
 */
export interface HighlightRenderParams {
  lang: string;
  code: string;
}

/** HTML `<span class="hljs-…">` ; l'hôte ne garde que `span` + `class`. */
export interface HighlightRenderResult {
  html: string;
}

/** Requêtes hôte → plugin : méthode → `{ params, result }`. */
export interface HostToPluginRequests {
  initialize: { params: InitializeParams; result: InitializeResult };
  "document/transform": { params: DocumentTransformParams; result: DocumentTransformResult };
  "fence/render": { params: FenceRenderParams; result: FenceRenderResult };
  "highlight/render": { params: HighlightRenderParams; result: HighlightRenderResult };
}

// --- Hôte → plugin : notifications (§6.6) ---------------------------------------

/**
 * `shutdown` figure au §6.1 mais l'hôte actuel ne l'envoie jamais : il tue le
 * worker sans préavis (`PluginHost.stop`), ce que la spec autorise aussi.
 */
export interface HostToPluginNotifications {
  "theme/changed": { theme: KdTheme };
  "locale/changed": { locale: string };
  shutdown: undefined;
}

// --- Plugin → hôte : services (§6.5) --------------------------------------------

/**
 * `host/readFile`, capacité `read:siblings`. Erreurs : `denied` (hors
 * confinement, hors allowlist `siblingExtensions`, ou hors traitement d'une
 * requête) / `not-found`.
 *
 * `dir` : le `dir` reçu avec la requête `document/transform`/`fence/render`
 * en cours — recommandé. Facultatif : sans lui, l'hôte prend le dossier du
 * seul document en cours de traitement, et répond `denied` si des requêtes
 * pour plusieurs dossiers sont en vol (§6.5).
 */
export interface HostReadFileParams {
  rel: string;
  dir?: string;
}

export interface HostReadFileResult {
  text: string;
}

/** Requêtes plugin → hôte. */
export interface PluginToHostRequests {
  "host/readFile": { params: HostReadFileParams; result: HostReadFileResult };
}

export type HostLogLevel = "debug" | "info" | "warn" | "error";

/** Notifications plugin → hôte. */
export interface PluginToHostNotifications {
  /** Journal du plugin (200 dernières entrées, `pluginLogs`). */
  "host/log": { level: HostLogLevel; message: string };
}

/**
 * Signaux internes du runtime `kd` (hors spec) : fin de l'import de l'entry,
 * réussi ou non. Attendus par l'hôte avant `initialize`.
 */
export interface RuntimeNotifications {
  "worker/ready": undefined;
  "worker/error": { message: string };
}

// --- Le global `kd` du worker (§12) -----------------------------------------------

type Awaitable<T> = T | Promise<T>;

/** Handler d'une requête entrante : son retour devient `result`, une exception `error`. */
export type KdRequestHandler<M extends keyof HostToPluginRequests> = (
  params: HostToPluginRequests[M]["params"],
) => Awaitable<HostToPluginRequests[M]["result"]>;

/** Handler d'une notification entrante : best effort, ses exceptions sont avalées. */
export type KdNotificationHandler<M extends keyof HostToPluginNotifications> = (
  params: HostToPluginNotifications[M],
) => Awaitable<void>;

/**
 * Erreur levée par `kd.request` quand l'hôte répond `error` ; un handler peut
 * aussi en lever une pour choisir le `code` renvoyé (défaut `internal`).
 */
export interface KdRequestError extends Error {
  code?: KdErrorCode;
}

/** API du global `kd`, vue d'un auteur de plugin. */
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

// --- Côté runtime (kd_runtime.js) -------------------------------------------------

/** Handler tel que stocké par le runtime : il ne valide pas `params`, l'hôte est la source. */
export type KdRawHandler = (params: unknown) => unknown;

/** Implémentation de `kd` dans le runtime : non générique, plus `__load` (appelé par le blob). */
export interface KdRuntimeApi {
  onRequest(method: string, handler: KdRawHandler): void;
  request(method: string, params?: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  __load?(entryUrl: string): Promise<void>;
}

/**
 * `globalThis` du worker vu par le runtime. La config TypeScript du projet
 * charge la lib `DOM` (fenêtres) et non `WebWorker` — les deux sont
 * incompatibles dans un même programme. `postMessage(msg)` et `self.onmessage`
 * compilent déjà sous `DOM` (surcharge `Window.postMessage(message, options?)`) ;
 * seul `kd`, propriété ajoutée au global, demande ce type, appliqué par cast à
 * `globalThis` dans `kd_runtime.js` (sans code ajouté). Les messages postés
 * sont vérifiés par `@satisfies KdOutgoingFromWorker`.
 */
export interface KdGlobal {
  kd: KdRuntimeApi;
}

/** Tout message qu'un worker peut poster à l'hôte. */
export type KdOutgoingFromWorker =
  | KdRequest
  | KdResponse
  | KdNotification;

/** Tout message que l'hôte peut poster au worker. */
export type KdOutgoingFromHost =
  | KdRequest<keyof HostToPluginRequests>
  | KdResponse
  | KdNotification<keyof HostToPluginNotifications>;
