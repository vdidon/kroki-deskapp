// Global `kd` injected by the host runtime (`ui/js/kd_runtime.js`) before
// the `main.js` entry, typed by the protocol v1 messages the host describes.
//
// Path relative to the application repo: the day the plugin moves out of it,
// copy `types/plugin-protocol.d.ts` (and the `Anchor` it imports from
// `types/ipc.d.ts`) here and point the import at it.
import type { KdApi } from "../../../types/plugin-protocol";

declare global {
  const kd: KdApi;
}

export {};
