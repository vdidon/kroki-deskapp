// Shared state of the main window (`state` of `ui/js/app.js`).

import type { Anchor, TabInfo } from "./ipc";

/** Display mode of a document. */
export type ViewMode = "preview" | "source" | "derived";

/** View of a document (one per tab, cf. `ensureViews` in `main.js`). */
export interface View {
  el: HTMLElement;
  /** Content already rendered at least once. */
  rendered: boolean;
  /** Render number: a stale render (seq exceeded) no longer writes anything. */
  seq: number;
  /** Render in progress: no anchor jump into a DOM under construction. */
  rendering?: boolean;
  /** Absolute path of the document. */
  path?: string;
  /** Document folder (resolution of relative links and images). */
  dir?: string;
  /** `html` = static page in an iframe, outside the markdown pipeline. */
  kind?: "doc" | "html";
  /** Displayed markdown (derived by a plugin where applicable); `null` for an HTML page. */
  markdown?: string | null;
  /** Actual source (markdown or format served by a plugin), for the source view. */
  sourceText?: string | null;
  /** Anchors of the derived markdown; non-null = document transformed by a plugin. */
  lineMap?: Anchor[] | null;
  /** Absent on a fresh view: behaves like `"preview"`. */
  mode?: ViewMode;
  /** DOM cached per mode (cf. `renderMode`). */
  domCache?: Partial<Record<ViewMode, Element | null>> | null;
}

/**
 * Views by document id. `get` accepts `null`: the code reads
 * `state.views.get(state.active)` everywhere, which is `undefined` with no active tab.
 */
export interface ViewMap extends Map<number, View> {
  get(key: number | null): View | undefined;
}

export interface AppState {
  tabs: TabInfo[];
  /** Active document or `null`. */
  active: number | null;
  views: ViewMap;
  /** Documents modified on disk, to re-render on activation. */
  stale: Set<number>;
}
