// Globals of the application's webviews (windows and render webview):
// the Tauri API injected by `withGlobalTauri: true`, typed on the `ipc.d.ts`
// contract. The globals of vendors loaded as classic `<script>`s are
// declared in `vendor.d.ts` (window) and `renderer.d.ts` (render webview).

import type { Commands, Events } from "./ipc";

/** `invoke` without a second argument when the command expects none. */
type InvokeArgs<K extends keyof Commands> = {} extends Commands[K]["args"]
  ? [args?: Commands[K]["args"]]
  : [args: Commands[K]["args"]];

export interface TauriEvent<E extends keyof Events> {
  event: E;
  id: number;
  payload: Events[E];
}

export type UnlistenFn = () => void;

export interface TauriGlobal {
  core: {
    invoke<K extends keyof Commands>(cmd: K, ...args: InvokeArgs<K>): Promise<Commands[K]["ret"]>;
    convertFileSrc(filePath: string, protocol?: string): string;
  };
  event: {
    listen<E extends keyof Events>(
      event: E,
      handler: (event: TauriEvent<E>) => void,
    ): Promise<UnlistenFn>;
  };
  webviewWindow: {
    getCurrentWebviewWindow(): { label: string };
  };
  app: {
    getVersion(): Promise<string>;
  };
}

declare global {
  interface Window {
    __TAURI__: TauriGlobal;
  }
}
