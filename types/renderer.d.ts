// Globals and modules of the hidden render webview (`ui/renderer/`): vendors
// loaded on demand by `renderer.js` (`loadScript` → global, `import()` →
// module), plus the bridges set up between its own scripts. Only the surface
// actually called by `renderer.js` is described, as found in the bundles of
// `ui/renderer/vendor/`. None of these globals exists in the main
// window (cf. `vendor.d.ts`): do not declare here any that is also there.

/** `t()` of `ui/renderer/i18n.js`, exposed to `erd.js` (classic script). */
export type RendererT = (key: string, params?: Record<string, unknown>) => string;

// ---------- dynamically imported vendors ----------

/** `vendor/graphviz.es.js` (@hpcc-js/wasm-graphviz). */
export interface GraphvizModule {
  Graphviz: { load(): Promise<Graphviz> };
}
export interface Graphviz {
  /** DOT source → output in the requested format (`"svg"`) with the layout engine. */
  layout(source: string, format?: string, engine?: string): string;
}

/** `vendor/d2.esm.js` (@terrastruct/d2) : wrapper around a WASM worker. */
export interface D2Module {
  D2: new () => D2;
}
export interface D2CompileOptions {
  layout?: string;
  themeID?: number;
  sketch?: boolean;
}
/** Result of `compile` (fields passed through as-is to `render`). */
export interface D2CompileResult {
  diagram: unknown;
  renderOptions: unknown;
}
export interface D2 {
  compile(source: string, options?: D2CompileOptions): Promise<D2CompileResult>;
  /** Serialized SVG. */
  render(diagram: unknown, options?: unknown): Promise<string>;
}

/** `vendor/excalidraw.esm.js` : bundle reduced to `exportToSvg` + `restore`. */
export interface ExcalidrawScene {
  elements: unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}
export interface ExcalidrawModule {
  restore(data: Partial<ExcalidrawScene>, localAppState: null, localElements: null): ExcalidrawScene;
  exportToSvg(opts: ExcalidrawScene & { exportPadding?: number }): Promise<SVGSVGElement>;
}

// ---------- vendors loaded as classic <script>s ----------

export interface Mermaid {
  initialize(config: { startOnLoad: boolean; securityLevel: string; theme: string }): void;
  render(id: string, source: string): Promise<{ svg: string }>;
}

/** Compiled Vega spec (`vega.parse`): opaque, only passed on to `View`. */
export type VegaRuntime = { readonly __vegaRuntime: unique symbol };
export interface VegaView {
  toSVG(): Promise<string>;
  finalize(): void;
}
export interface Vega {
  parse(spec: unknown, config: null, options: { ast: boolean }): VegaRuntime;
  View: new (runtime: VegaRuntime, options: { renderer: string; expr?: unknown }) => VegaView;
  /** Added to `window.vega` by `vendor/vega-interpreter.min.js`. */
  expressionInterpreter?: unknown;
}
export interface VegaLite {
  compile(spec: unknown): { spec: unknown };
}

export interface WaveDrom {
  /** Only form exposed by `vendor/wavedrom.min.js` (cf. `renderWaveForm`). */
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
    /** i18n bridge: set by `renderer.js` before any loading of `erd.js`. */
    rendererT: RendererT;
    /** Set by `erd.js` when it runs. */
    erdToDot?: (source: string) => string;

    // Globals defined once their `loadScript` has resolved (never called before).
    mermaid: Mermaid;
    vega: Vega;
    vegaLite: VegaLite;
    /**
     * Fallback of `exprInterpreter()`: the vendored bundle does NOT expose this
     * global (it extends `window.vega`), the branch is never taken.
     */
    vegaInterpreter?: { expressionInterpreter?: unknown };
    WaveDrom: WaveDrom;
    nomnoml: Nomnoml;
    /** Checked with `typeof` after loading (`dbml.js`, `bpmn-viewer.min.js`). */
    dbmlToDot?: (source: string) => string;
    BpmnJS?: new (options: { container: HTMLElement }) => BpmnViewer;
    /** Read by excalidraw at import time to locate its assets (fonts). */
    EXCALIDRAW_ASSET_PATH?: string;

    // Pseudo Node environment of bytefield-svg (`shim-pre.js` / `shim-post.js`).
    module?: { exports: unknown };
    global?: typeof globalThis;
    process?: { env: Record<string, string> };
    /** CommonJS export picked up by `shim-post.js`: shape not guaranteed. */
    __bytefield?: unknown;
  }
}
