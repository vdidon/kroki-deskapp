// @ts-check

// File drag & drop from Explorer (native Tauri drag & drop).

import { invoke, listen } from "./app.js";
import { isOpenableDocPath, isPluginArchivePath, isSessionFilePath } from "./plugins.js";
import { requestPluginInstall } from "./plugins_ui.js";

const overlay = /** @type {HTMLElement} */ (document.getElementById("drop-overlay"));

// Openable documents (native extensions + active plugins), `.kdext` plugin
// archives (routed to the install flow, spec §9.2) and `.kdws` sessions
// (routed on the Rust side by `open_mixed_paths`).
/**
 * @param {string[] | null | undefined} paths
 * @returns {string[]}
 */
function accepted(paths) {
  return (paths ?? []).filter(
    (p) => isOpenableDocPath(p) || isPluginArchivePath(p) || isSessionFilePath(p),
  );
}

export async function initFileDrop() {
  await listen("tauri://drag-enter", (e) => {
    if (accepted(e.payload?.paths).length) overlay.hidden = false;
  });
  await listen("tauri://drag-leave", () => {
    overlay.hidden = true;
  });
  await listen("tauri://drag-drop", (e) => {
    overlay.hidden = true;
    const paths = accepted(e.payload?.paths);
    const docs = paths.filter((p) => !isPluginArchivePath(p));
    if (docs.length) invoke("open_paths", { paths: docs });
    for (const archive of paths.filter(isPluginArchivePath)) {
      requestPluginInstall(archive);
    }
  });
  // Windows: a custom native IDropTarget (drop_target.rs) replaces wry's to
  // also accept text paths (Cursor/VS Code). Opening documents and routing
  // .kdext files are done on the Rust side; here we only drive the overlay
  // through this event.
  await listen("drop-overlay", (e) => {
    overlay.hidden = !e.payload;
  });
}
