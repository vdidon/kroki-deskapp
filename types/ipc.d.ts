// Contrat front ↔ back : arguments et retours des commandes Tauri, payloads des
// événements. Recopié à la main des signatures Rust (`commands.rs`, `plugins.rs`,
// `updates.rs`) et des structs serde ; `tests/test_ipc_types.mjs` vérifie que
// commandes et noms d'arguments restent alignés sur le Rust.
//
// Conventions de sérialisation à respecter en modifiant ce fichier :
// - arguments : Tauri convertit les paramètres Rust snake_case en camelCase ;
//   les paramètres `AppHandle`, `WebviewWindow`, `State<…>` ne sont pas passés ;
// - retours : champs tels que serde les écrit — snake_case sauf
//   `#[serde(rename_all = "camelCase")]` (PluginInfo, ManifestPreview) ;
// - `Result<T, String>` : la promesse rejette avec la chaîne d'erreur.

/** Ligne du markdown généré → ligne du source (§6.2 du protocole de plugins). */
export type Anchor = [mdLine: number, srcLine: number];

export interface TabInfo {
  id: number;
  title: string;
  path: string;
}

/** `state::TabsPayload` — retour de `get_window_state`, payload de `tabs-updated`. */
export interface TabsPayload {
  window: string;
  tabs: TabInfo[];
  active: number | null;
}

/** `commands::DocPayload`. */
export interface DocPayload {
  id: number;
  title: string;
  path: string;
  dir: string;
  markdown: string;
}

/** `state::SettingsData` (persisté dans settings.json). */
export interface SettingsData {
  external_url: string;
  server_enabled: boolean;
  server_port: number;
  theme: string;
  language: string;
  /** Partiel : seules les icônes explicitement (dé)cochées y figurent. */
  icons: Record<string, boolean>;
  removed_plugins: string[];
  update_check: boolean;
  update_checked_at: number;
}

/** `commands::SettingsInfo` (SettingsData aplati + infos d'environnement). */
export interface SettingsInfo extends SettingsData {
  supported: string;
  java_available: boolean;
  tex_available: boolean;
}

/** `engine::RuntimeGroup`. */
export interface RuntimeGroup {
  runtime: "native" | "webview" | "jvm" | "tex" | "external";
  label: string;
  requirement: string;
  status: "ok" | "blocked" | "unsupported";
  note: string;
  types: string[];
}

/** `manager::PendingAnchor`. */
export interface PendingAnchor {
  path: string;
  fragment: string;
}

/** `plugins::PluginInfo`. */
export interface PluginInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  publisher: string;
  apiVersion: string;
  runtime: string;
  entry: string;
  extensions: string[];
  fences: string[];
  highlights: string[];
  capabilities: string[];
  siblingExtensions: string[];
  status: "ok" | "inert" | "invalid";
  statusReason: string;
  warnings: string[];
  hasChangelog: boolean;
  installedAt: number;
}

/** `plugins::ManifestPreview`. */
export interface ManifestPreview {
  id: string;
  name: string;
  description: string;
  version: string;
  publisher: string;
  extensions: string[];
  fences: string[];
  highlights: string[];
  capabilities: string[];
  siblingExtensions: string[];
  installedVersion: string | null;
  downgrade: boolean;
}

/** `plugins::SiblingError` — valeur de rejet de `plugin_read_sibling`. */
export interface SiblingError {
  code: "not-found" | "denied";
  message: string;
}

/** `updates::UpdateInfo`. */
export interface UpdateInfo {
  current: string;
  latest: string;
  newer: boolean;
  release_url: string;
  download_url: string;
  download_file: string | null;
}

/** Catalogue de langue complété par l'anglais (`get_i18n`). */
export interface I18nPayload {
  locale: string;
  setting: string;
  /** Langues livrées ; `name` = endonyme (`language.name` du catalogue). */
  languages: { code: string; name: string }[];
  messages: Record<string, string | Record<string, string>>;
}

type NoArgs = Record<string, never>;

/** Commande → { args, ret }. Clé = nom passé à `invoke`. */
export interface Commands {
  // commands.rs
  get_window_state: { args: NoArgs; ret: TabsPayload };
  read_document: { args: { docId: number }; ret: DocPayload };
  render_diagram: {
    args: { diagramType: string; source: string; options?: Record<string, string> | null };
    ret: string;
  };
  renderer_ready: { args: NoArgs; ret: void };
  render_job_done: { args: { id: number; svg?: string | null; error?: string | null }; ret: void };
  open_paths: { args: { paths: string[] }; ret: void };
  take_pending_anchors: { args: NoArgs; ret: PendingAnchor[] };
  open_file_dialog: { args: NoArgs; ret: void };
  activate_tab: { args: { docId: number }; ret: void };
  close_tab: { args: { docId: number }; ret: void };
  close_tabs_around: { args: { docId: number; side: string }; ret: void };
  detach_tab: { args: { docId: number }; ret: void };
  reveal_tab_file: { args: { docId: number }; ret: void };
  reorder_tab: { args: { docId: number; index: number }; ret: void };
  new_window: { args: NoArgs; ret: string };
  close_window: { args: NoArgs; ret: void };
  set_title: { args: { title: string }; ret: void };
  focus_window: { args: { label: string }; ret: void };
  finish_tab_drag: { args: { docId: number }; ret: void };
  debug_finish_tab_drag_at: { args: { docId: number; x: number; y: number }; ret: void };
  get_settings: { args: NoArgs; ret: SettingsInfo };
  get_runtimes: { args: NoArgs; ret: RuntimeGroup[] };
  get_changelog: { args: NoArgs; ret: string };
  get_theme: { args: NoArgs; ret: string };
  get_i18n: { args: NoArgs; ret: I18nPayload };
  get_icons: { args: NoArgs; ret: Record<string, boolean> };
  set_settings: {
    args: {
      externalUrl: string;
      serverEnabled: boolean;
      serverPort: number;
      theme: string;
      language: string;
      icons: Record<string, boolean>;
      updateCheck: boolean;
    };
    ret: void;
  };
  open_link: { args: { baseDir: string; href: string }; ret: void };
  read_data_file: { args: { baseDir: string; rel: string }; ret: string };
  export_html: { args: { suggestedName: string; html: string }; ret: boolean };
  save_session: { args: NoArgs; ret: boolean };
  // plugins.rs
  list_plugins: { args: NoArgs; ret: PluginInfo[] };
  plugin_manifest_preview: { args: { path: string }; ret: ManifestPreview };
  install_plugin: { args: { path: string }; ret: void };
  uninstall_plugin: { args: { id: string }; ret: void };
  pick_plugin_archive: { args: NoArgs; ret: void };
  take_pending_plugin_installs: { args: NoArgs; ret: string[] };
  open_plugins_dir: { args: NoArgs; ret: void };
  plugin_changelog: { args: { id: string }; ret: string };
  plugin_read_sibling: { args: { pluginId: string; baseDir: string; rel: string }; ret: string };
  // updates.rs
  check_update: { args: { automatic: boolean }; ret: UpdateInfo | null };
}

/** Diffusion entre fenêtres : `from` = label de la fenêtre émettrice. */
interface Broadcast {
  from: string;
}

/** Événement → payload. */
export interface Events {
  "tabs-updated": TabsPayload;
  "anchor-request": null;
  "doc-changed": { window: string; id: number };
  "drop-overlay": boolean;
  "theme-changed": Broadcast & { mode: string };
  "locale-changed": Broadcast & { locale: string };
  "icons-changed": Broadcast & { icons: Record<string, boolean> };
  "plugins-changed": PluginInfo[];
  "plugin-install-request": null;
  "session-report": { message: string; error: boolean };
  "render-job": {
    id: number;
    dtype: string;
    source: string;
    /** Toujours présent (`serde_json::Map`, éventuellement vide) : valeurs chaîne. */
    options: Record<string, string>;
  };
  // Émis par Tauri lui-même (glisser-déposer natif de wry), pas par notre Rust :
  // hors du périmètre de tests/test_ipc_types.mjs. Sous Windows, drop_target.rs
  // remplace la cible de wry et émet `drop-overlay` à la place.
  "tauri://drag-enter": TauriDragDrop;
  "tauri://drag-over": { position: PhysicalPosition };
  "tauri://drag-drop": TauriDragDrop;
  "tauri://drag-leave": null;
}

/** Position en pixels physiques (`tauri::PhysicalPosition<f64>`). */
export interface PhysicalPosition {
  x: number;
  y: number;
}

/** `DragDropEvent::Enter` / `Drop` sérialisé par Tauri. */
export interface TauriDragDrop {
  paths: string[];
  position: PhysicalPosition;
}
