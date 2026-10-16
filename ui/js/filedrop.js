// Glisser-déposer de fichiers depuis l'Explorateur (drag & drop natif Tauri).

import { invoke, listen } from "./app.js";
import { isOpenableDocPath, isPluginArchivePath, isSessionFilePath } from "./plugins.js";
import { requestPluginInstall } from "./plugins_ui.js";

const overlay = document.getElementById("drop-overlay");

// Documents ouvrables (extensions natives + plugins actifs), archives de
// plugins `.kdext` (routées vers le flux d'installation, spec §9.2) et
// sessions `.kdws` (routées côté Rust par `open_mixed_paths`).
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
  // Windows : un IDropTarget natif custom (drop_target.rs) remplace celui de
  // wry pour aussi accepter les chemins texte (Cursor/VS Code). L'ouverture des
  // documents et le routage des .kdext sont faits côté Rust ; ici on ne pilote
  // que l'overlay via cet événement.
  await listen("drop-overlay", (e) => {
    overlay.hidden = !e.payload;
  });
}
