// Globales et modules de la webview de rendu cachée (`ui/renderer/`) : vendors
// chargés à la demande par `renderer.js` (`loadScript` → globale, `import()` →
// module), plus les ponts posés entre ses propres scripts. Seule la surface
// réellement appelée par `renderer.js` est décrite, relevée dans les bundles de
// `ui/renderer/vendor/`. Aucune de ces globales n'existe dans la fenêtre
// principale (cf. `vendor.d.ts`) : n'en déclarer ici aucune qui y soit aussi.

/** `t()` de `ui/renderer/i18n.js`, exposé à `erd.js` (script classique). */
export type RendererT = (key: string, params?: Record<string, unknown>) => string;

// ---------- vendors importés dynamiquement ----------

/** `vendor/graphviz.es.js` (@hpcc-js/wasm-graphviz). */
export interface GraphvizModule {
  Graphviz: { load(): Promise<Graphviz> };
}
export interface Graphviz {
  /** Source DOT → sortie au format demandé (`"svg"`) avec le moteur de layout. */
  layout(source: string, format?: string, engine?: string): string;
}

/** `vendor/d2.esm.js` (@terrastruct/d2) : wrapper d'un worker WASM. */
export interface D2Module {
  D2: new () => D2;
}
export interface D2CompileOptions {
  layout?: string;
  themeID?: number;
  sketch?: boolean;
}
/** Résultat de `compile` (champs relayés tels quels à `render`). */
export interface D2CompileResult {
  diagram: unknown;
  renderOptions: unknown;
}
export interface D2 {
  compile(source: string, options?: D2CompileOptions): Promise<D2CompileResult>;
  /** SVG sérialisé. */
  render(diagram: unknown, options?: unknown): Promise<string>;
}

/** `vendor/excalidraw.esm.js` : bundle réduit à `exportToSvg` + `restore`. */
export interface ExcalidrawScene {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}
export interface ExcalidrawModule {
  restore(data: Partial<ExcalidrawScene>, localAppState: null, localElements: null): ExcalidrawScene;
  exportToSvg(opts: ExcalidrawScene & { exportPadding?: number }): Promise<SVGSVGElement>;
}

// ---------- vendors chargés en <script> classique ----------

export interface Mermaid {
  initialize(config: { startOnLoad: boolean; securityLevel: string; theme: string }): void;
  render(id: string, source: string): Promise<{ svg: string }>;
}

/** Spec Vega compilée (`vega.parse`) : opaque, seulement relayée à `View`. */
export type VegaRuntime = { readonly __vegaRuntime: unique symbol };
export interface VegaView {
  toSVG(): Promise<string>;
  finalize(): void;
}
export interface Vega {
  parse(spec: unknown, config: null, options: { ast: boolean }): VegaRuntime;
  View: new (runtime: VegaRuntime, options: { renderer: string; expr?: unknown }) => VegaView;
  /** Ajouté à `window.vega` par `vendor/vega-interpreter.min.js`. */
  expressionInterpreter?: unknown;
}
export interface VegaLite {
  compile(spec: unknown): { spec: unknown };
}

export interface WaveDrom {
  /** Seule forme exposée par `vendor/wavedrom.min.js` (cf. `renderWaveForm`). */
  RenderWaveForm?(index: number, source: unknown, outputPrefix: string): void;
  renderWaveForm?(index: number, source: unknown, outputPrefix: string): void;
}

export interface Nomnoml {
  renderSvg(source: string): string;
}

export interface BpmnViewer {
  importXML(xml: string): Promise<unknown>;
  get(service: "canvas"): { zoom(level: "fit-viewport"): unknown };
  saveSVG(): Promise<{ svg: string }>;
  destroy(): void;
}

declare global {
  interface Window {
    /** Pont i18n : posé par `renderer.js` avant tout chargement d'`erd.js`. */
    rendererT: RendererT;
    /** Posé par `erd.js` à son exécution. */
    erdToDot?: (source: string) => string;

    // Globales définies une fois leur `loadScript` résolu (jamais appelées avant).
    mermaid: Mermaid;
    vega: Vega;
    vegaLite: VegaLite;
    /**
     * Repli de `exprInterpreter()` : le bundle vendoré n'expose PAS cette
     * globale (il étend `window.vega`), la branche n'est jamais prise.
     */
    vegaInterpreter?: { expressionInterpreter?: unknown };
    WaveDrom: WaveDrom;
    nomnoml: Nomnoml;
    /** Vérifiées par `typeof` après chargement (`dbml.js`, `bpmn-viewer.min.js`). */
    dbmlToDot?: (source: string) => string;
    BpmnJS?: new (options: { container: HTMLElement }) => BpmnViewer;
    /** Lu par excalidraw à l'import pour localiser ses assets (polices). */
    EXCALIDRAW_ASSET_PATH?: string;

    // Pseudo-environnement Node de bytefield-svg (`shim-pre.js` / `shim-post.js`).
    module?: { exports: unknown };
    global?: typeof globalThis;
    process?: { env: Record<string, string> };
    /** Export CommonJS récupéré par `shim-post.js` : forme non garantie. */
    __bytefield?: unknown;
  }
}
