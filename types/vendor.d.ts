// Globales des vendors de la fenêtre principale, chargés en `<script>` classique
// par `ui/index.html` (markdown-it, highlight.js, DOMPurify, KaTeX, texmath) ou
// injectés à la demande (Plotly, cf. `ensurePlotly` dans render.js).
//
// Seule la surface réellement appelée par `ui/js/*.js` est déclarée — pas les
// typings complets des bibliothèques. Versions de référence : markdown-it 14.2.0,
// highlight.js 11.11.1, DOMPurify 3.4.8, Plotly 3.8.2 (`ui/vendor/`).
// L'API CSS Custom Highlight (`CSS.highlights`, `Highlight`) est couverte par
// `lib.dom` : rien à déclarer ici.

// --- markdown-it --------------------------------------------------------------

/** `Token` de markdown-it (sortie de `parse`, entrée des règles de rendu). */
export interface MarkdownItToken {
  type: string;
  tag: string;
  /** `[début, fin]` en lignes 0-based du source ; `null` pour un token inline. */
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

/** État du parseur de blocs (`StateBlock`), argument d'une règle de bloc. */
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

/** État de la passe « core » (`StateCore`), argument d'une règle core. */
export interface MarkdownItStateCore {
  tokens: MarkdownItToken[];
  Token: new (type: string, tag: string, nesting: number) => MarkdownItToken;
}

export interface MarkdownItOptions {
  html?: boolean;
  linkify?: boolean;
  /** Chaîne vide = échappement par défaut de markdown-it. */
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

/** Le moteur passé à texmath : il n'en appelle que `renderToString`. */
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
  /** `undefined` si la grammaire n'est pas enregistrée. */
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
  /** Sans `RETURN_DOM*` dans la config (jamais utilisé ici) : une chaîne. */
  sanitize(dirty: string, config?: DOMPurifyConfig): string;
}

// --- Plotly -------------------------------------------------------------------

/** Élément pris en main par Plotly : `_fullLayout` = mise en page résolue (interne). */
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
    /** Optionnels : render.js se passe des formules si leur script manque. */
    katex?: Katex;
    texmath?: (md: MarkdownIt, options: TexmathOptions) => void;
    /** Absent tant que la première figure n'a pas injecté le bundle. */
    Plotly?: Plotly;
  }
}
