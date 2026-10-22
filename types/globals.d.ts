// Globales des webviews de l'application (fenêtres et webview de rendu) :
// l'API Tauri injectée par `withGlobalTauri: true`, typée sur le contrat
// `ipc.d.ts`. Les globales des vendors chargés en `<script>` classique sont
// déclarées dans `vendor.d.ts` (fenêtre) et `renderer.d.ts` (webview de rendu).

import type { Commands, Events } from "./ipc";

/** `invoke` sans second argument quand la commande n'en attend aucun. */
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
