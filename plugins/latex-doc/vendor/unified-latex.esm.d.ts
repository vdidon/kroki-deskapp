// Types du bundle vendoré `unified-latex.esm.js` (getParser + printRaw) —
// uniquement ce que le plugin consomme.
//
// Placé **à côté** du bundle, sous le même nom : pour `import … from
// "./vendor/unified-latex.esm.js"`, tsc essaie `unified-latex.esm.d.ts` avant
// le `.js` — le bundle (~245 Ko minifiés, sans types) n'est donc jamais lu ni
// inféré, sans `paths` ni cast à l'import. `build_vendor.py` ne réécrit que le
// `.js` : ce fichier survit à une régénération, mais doit être relu après une
// montée de version de unified-latex. Absent de `packInclude` : il n'est ni
// empaqueté dans le `.kdext` ni embarqué dans le binaire.
//
// Établi à partir de `@unified-latex/unified-latex-types` et de ce que produit
// réellement le parseur vendoré, qui s'en écarte sur un point : `env` est une
// chaîne pour `environment`/`verbatim`/`verb`, mais un nœud `string` pour
// `mathenv` (`{type: "string", content: "align"}`). `printRaw` lit les deux.
//
// `content?: undefined` / `args?: undefined` sur les nœuds qui n'en ont pas :
// propriétés absentes à l'exécution, déclarées pour qu'un parcours générique
// (`x.content`, `x.args ?? []` sur un `Node` quelconque) se type sans cast.

export interface Point {
  offset: number;
  line: number; // 1-based
  column: number;
}

export interface Position {
  start: Point;
  end: Point;
  source?: unknown;
}

interface BaseNode {
  position?: Position;
  _renderInfo?: Record<string, unknown>;
}

/** Racine renvoyée par `parse` — jamais présente dans un `content`. */
export interface Root extends BaseNode {
  type: "root";
  content: Node[];
}

export interface StringNode extends BaseNode {
  type: "string";
  content: string;
  args?: undefined;
}

export interface Whitespace extends BaseNode {
  type: "whitespace";
  content?: undefined;
  args?: undefined;
}

export interface Parbreak extends BaseNode {
  type: "parbreak";
  content?: undefined;
  args?: undefined;
}

export interface Comment extends BaseNode {
  type: "comment";
  content: string;
  sameline?: boolean;
  suffixParbreak?: boolean;
  leadingWhitespace?: boolean;
  args?: undefined;
}

/** `\name` : `content` est le nom, sans l'antislash. */
export interface Macro extends BaseNode {
  type: "macro";
  content: string;
  escapeToken?: string;
  /** Absent pour une macro sans signature connue du parseur. */
  args?: Argument[];
}

export interface Environment extends BaseNode {
  type: "environment";
  env: string;
  content: Node[];
  args?: Argument[];
}

/** Environnement mathématique (`align`, `equation`…), reconnu par le parseur. */
export interface MathEnv extends BaseNode {
  type: "mathenv";
  env: string | StringNode;
  content: Node[];
  args?: Argument[];
}

/** `verbatim`, `comment`… : contenu brut, non parsé. */
export interface VerbatimEnvironment extends BaseNode {
  type: "verbatim";
  env: string;
  content: string;
  args?: undefined;
}

export interface InlineMath extends BaseNode {
  type: "inlinemath";
  content: Node[];
  args?: undefined;
}

export interface DisplayMath extends BaseNode {
  type: "displaymath";
  content: Node[];
  args?: undefined;
}

export interface Group extends BaseNode {
  type: "group";
  content: Node[];
  args?: undefined;
}

/** `\verb|…|`. */
export interface Verb extends BaseNode {
  type: "verb";
  env: string;
  escape: string;
  content: string;
  args?: undefined;
}

/**
 * Argument d'une macro ou d'un environnement. `openMark`/`closeMark` valent
 * `""` pour un argument optionnel absent — c'est ce qui le distingue d'un `[]`
 * vide.
 */
export interface Argument extends BaseNode {
  type: "argument";
  content: Node[];
  openMark: string;
  closeMark: string;
}

/** Nœud d'une liste `content` — union discriminée sur `type`. */
export type Node =
  | StringNode
  | Whitespace
  | Parbreak
  | Comment
  | Macro
  | Environment
  | MathEnv
  | VerbatimEnvironment
  | InlineMath
  | DisplayMath
  | Group
  | Verb;

/** Ce que `printRaw` sait sérialiser. */
export type Ast = Root | Node | Argument | string | ReadonlyArray<Ast>;

/** Signature déclarée au parseur (`"o m"`, `"m"`…), syntaxe xparse. */
export interface ArgSpec {
  signature?: string;
  renderInfo?: Record<string, unknown>;
}

export interface ParserOptions {
  mode?: "regular" | "math";
  macros?: Record<string, ArgSpec>;
  environments?: Record<string, ArgSpec>;
  flags?: {
    atLetter?: boolean;
    expl3?: boolean;
    autodetectExpl3AndAtLetter?: boolean;
  };
}

/** Processeur unified figé ; seul `parse` est utilisé. */
export interface Parser {
  parse(source: string): Root;
}

export function getParser(options?: ParserOptions): Parser;

export function printRaw(node: Ast, options?: { asArray?: false }): string;
export function printRaw(node: Ast, options: { asArray: true }): string[];
