// Global `kd` injecté par le runtime de l'hôte (`ui/js/kd_runtime.js`) avant
// l'entry `main.js`, typé par les messages du protocole v1 que décrit l'hôte.
//
// Chemin relatif au dépôt de l'application : le jour où le plugin en sort,
// copier `types/plugin-protocol.d.ts` (et l'`Anchor` qu'il importe de
// `types/ipc.d.ts`) ici et pointer l'import dessus.
import type { KdApi } from "../../../types/plugin-protocol";

declare global {
  const kd: KdApi;
}

export {};
