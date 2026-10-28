// Front ↔ back contract: arguments and return values of the Tauri commands,
// event payloads. Hand-copied from the Rust signatures (`commands.rs`, `plugins.rs`,
// `updates.rs`, `journal.rs`) and the serde structs; `tests/test_ipc_types.mjs` checks that
// commands and argument names stay aligned with the Rust.
//
// Serialization conventions to respect when editing this file:
// - arguments: Tauri converts the Rust snake_case parameters to camelCase;
//   the `AppHandle`, `WebviewWindow`, `State<…>` parameters are not passed;
// - return values: fields as serde writes them — snake_case except
//   `#[serde(rename_all = "camelCase")]` (PluginInfo, ManifestPreview);
// - `Result<T, String>`: the promise rejects with the error string.

/** Generated markdown line → source line (§6.2 of the plugin protocol). */
export type Anchor = [mdLine: number, srcLine: number];

export interface TabInfo {
  id: number;
  title: string;
  path: string;
}

/** `state::TabsPayload` — return value of `get_window_state`, payload of `tabs-updated`. */
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

/** `state::SettingsData` (persisted in settings.json). */
export interface SettingsData {
  external_url: string;
  server_enabled: boolean;
  server_port: number;
  theme: string;
  language: string;
  /** Partial: only the explicitly checked/unchecked icons appear here. */
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

/** `journal::JournalEntry` — return value of `get_journal`, payload of `journal-entry`. */
export interface JournalEntry {
  seq: number;
  /** Milliseconds since the Unix epoch. */
  time: number;
  level: "debug" | "info" | "warn" | "error";
  /** Rust module (`server`, `watcher`…) or plugin id if `plugin`. */
  source: string;
  plugin: boolean;
  message: string;
}

/** Language catalog completed with English (`get_i18n`). */
export interface I18nPayload {
  locale: string;
  setting: string;
  /** Shipped languages; `name` = endonym (`language.name` of the catalog). */
  languages: { code: string; name: string }[];
  messages: Record<string, string | Record<string, string>>;
}

type NoArgs = Record<string, never>;

/** Command → { args, ret }. Key = name passed to `invoke`. */
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
  duplicate_tab: { args: { docId: number }; ret: void };
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
  // journal.rs
  get_journal: { args: NoArgs; ret: JournalEntry[] };
  plugin_log: { args: { pluginId: string; level: string; message: string }; ret: void };
}

/** Broadcast between windows: `from` = label of the emitting window. */
interface Broadcast {
  from: string;
}

/** Event → payload. */
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
  "journal-entry": JournalEntry;
  "render-job": {
    id: number;
    dtype: string;
    source: string;
    /** Always present (`serde_json::Map`, possibly empty): string values. */
    options: Record<string, string>;
  };
  // Emitted by Tauri itself (wry's native drag-and-drop), not by our Rust:
  // outside the scope of tests/test_ipc_types.mjs. On Windows, drop_target.rs
  // replaces wry's target and emits `drop-overlay` instead.
  "tauri://drag-enter": TauriDragDrop;
  "tauri://drag-over": { position: PhysicalPosition };
  "tauri://drag-drop": TauriDragDrop;
  "tauri://drag-leave": null;
}

/** Position in physical pixels (`tauri::PhysicalPosition<f64>`). */
export interface PhysicalPosition {
  x: number;
  y: number;
}

/** `DragDropEvent::Enter` / `Drop` serialized by Tauri. */
export interface TauriDragDrop {
  paths: string[];
  position: PhysicalPosition;
}
