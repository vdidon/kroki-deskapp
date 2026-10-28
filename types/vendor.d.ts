// Globals of the main window's vendors, loaded as classic `<script>`s
// by `ui/index.html` (markdown-it, highlight.js, DOMPurify, KaTeX, texmath) or
// injected on demand (Plotly, cf. `ensurePlotly` in render.js).
//
// Only the surface actually called by `ui/js/*.js` is declared — not the
// full typings of the libraries. Reference versions: markdown-it 14.2.0,
// highlight.js 11.11.1, DOMPurify 3.4.8, Plotly 3.8.2 (`ui/vendor/`).
// The CSS Custom Highlight API (`CSS.highlights`, `Highlight`) is covered by
// `lib.dom`: nothing to declare here.

// --- markdown-it --------------------------------------------------------------

/** markdown-it `Token` (output of `parse`, input of the render rules). */
export interface MarkdownItToken {
  type: string;
  tag: string;
  /** `[start, end]` as 0-based source lines; `null` for an inline token. */
  map: [number, number] | null;
  nesting: number;
  level: number;
  children: MarkdownItToken[] | null;
  content: string;
  markup: string;
  info: string;
  attrGet(name: string): string | null;
  attrSet(name: string, value: string): void;
  attrJoin(name: string, value: string): void;
}

/** Block parser state (`StateBlock`), argument of a block rule. */
export interface MarkdownItStateBlock {
  src: string;
  bMarks: number[];
  eMarks: number[];
  tShift: number[];
  blkIndent: number;
  line: number;
  push(type: string, tag: string, nesting: number): MarkdownItToken;
  getLines(begin: number, end: number, indent: number, keepLastLF: boolean): string;
}

/** State of the "core" pass (`StateCore`), argument of a core rule. */
export interface MarkdownItStateCore {
  tokens: MarkdownItToken[];
  Token: new (type: string, tag: string, nesting: number) => MarkdownItToken;
}

export interface MarkdownItOptions {
  html?: boolean;
  linkify?: boolean;
  /** Empty string = markdown-it's default escaping. */
  highlight?: (code: string, lang: string, attrs: string) => string;
}

export type MarkdownItBlockRule = (
  state: MarkdownItStateBlock,
  startLine: number,
  endLine: number,
  silent: boolean,
) => boolean;

export type MarkdownItCoreRule = (state: MarkdownItStateCore) => void;

export interface MarkdownItRuler<R> {
  before(beforeName: string, ruleName: string, fn: R): void;
  push(ruleName: string, fn: R): void;
}

export interface MarkdownItRenderer {
  rules: Record<string, MarkdownItRenderRule | undefined>;
  renderToken(tokens: MarkdownItToken[], idx: number, options: MarkdownItOptions): string;
}

export type MarkdownItRenderRule = (
  tokens: MarkdownItToken[],
  idx: number,
  options: MarkdownItOptions,
  env: object,
  self: MarkdownItRenderer,
) => string;

export interface MarkdownIt {
  block: { ruler: MarkdownItRuler<MarkdownItBlockRule> };
  core: { ruler: MarkdownItRuler<MarkdownItCoreRule> };
  renderer: MarkdownItRenderer;
  use<O>(plugin: (md: MarkdownIt, options: O) => void, options: O): MarkdownIt;
  render(src: string, env?: object): string;
  parse(src: string, env: object): MarkdownItToken[];
}

// --- KaTeX + markdown-it-texmath ----------------------------------------------

export interface KatexOptions {
  throwOnError?: boolean;
  output?: "html" | "mathml" | "htmlAndMathml";
}

/** The engine passed to texmath: it only calls `renderToString`. */
export interface Katex {
  renderToString(tex: string, options?: KatexOptions): string;
}

export interface TexmathOptions {
  engine: Katex;
  delimiters?: "dollars" | "brackets" | "gitlab" | "julia" | "kramdown" | "beg_end";
  katexOptions?: KatexOptions;
}

// --- highlight.js -------------------------------------------------------------

export interface Hljs {
  /** `undefined` if the grammar is not registered. */
  getLanguage(name: string): object | undefined;
  highlight(code: string, options: { language: string; ignoreIllegals?: boolean }): { value: string };
}

// --- DOMPurify ----------------------------------------------------------------

export interface DOMPurifyConfig {
  USE_PROFILES?: { html?: boolean; svg?: boolean; svgFilters?: boolean; mathMl?: boolean };
  ADD_ATTR?: string[];
  ALLOWED_TAGS?: string[];
  ALLOWED_ATTR?: string[];
}

export interface DOMPurify {
  /** Without `RETURN_DOM*` in the config (never used here): a string. */
  sanitize(dirty: string, config?: DOMPurifyConfig): string;
}

// --- Plotly -------------------------------------------------------------------

/** Element taken over by Plotly: `_fullLayout` = resolved layout (internal). */
export interface PlotlyHTMLElement extends HTMLElement {
  _fullLayout?: { width: number; height: number };
}

export interface Plotly {
  newPlot(
    el: HTMLElement,
    data: unknown[],
    layout?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ): Promise<PlotlyHTMLElement>;
  relayout(el: HTMLElement, update: Record<string, unknown>): Promise<PlotlyHTMLElement>;
}

declare global {
  interface Window {
    markdownit(options?: MarkdownItOptions): MarkdownIt;
    hljs: Hljs;
    DOMPurify: DOMPurify;
    /** Optional: render.js goes without formulas if their script is missing. */
    katex?: Katex;
    texmath?: (md: MarkdownIt, options: TexmathOptions) => void;
    /** Absent until the first figure has injected the bundle. */
    Plotly?: Plotly;
  }
}
