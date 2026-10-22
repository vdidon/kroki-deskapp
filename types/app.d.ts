// État partagé de la fenêtre principale (`state` de `ui/js/app.js`).

import type { Anchor, TabInfo } from "./ipc";

/** Mode d'affichage d'un document. */
export type ViewMode = "preview" | "source" | "derived";

/** Vue d'un document (une par onglet, cf. `ensureViews` dans `main.js`). */
export interface View {
  el: HTMLElement;
  /** Contenu déjà rendu au moins une fois. */
  rendered: boolean;
  /** Numéro de rendu : un rendu obsolète (seq dépassé) n'écrit plus rien. */
  seq: number;
  /** Rendu en cours : pas de saut d'ancre dans un DOM en chantier. */
  rendering?: boolean;
  /** Chemin absolu du document. */
  path?: string;
  /** Dossier du document (résolution des liens et images relatifs). */
  dir?: string;
  /** `html` = page statique en iframe, hors pipeline markdown. */
  kind?: "doc" | "html";
  /** Markdown affiché (dérivé par un plugin le cas échéant) ; `null` pour une page HTML. */
  markdown?: string | null;
  /** Source réel (markdown ou format servi par un plugin), pour la vue source. */
  sourceText?: string | null;
  /** Ancres du markdown dérivé ; non nul = document transformé par un plugin. */
  lineMap?: Anchor[] | null;
  /** Absent sur une vue neuve : se comporte comme `"preview"`. */
  mode?: ViewMode;
  /** DOM mémorisé par mode (cf. `renderMode`). */
  domCache?: Partial<Record<ViewMode, Element | null>> | null;
}

/**
 * Vues par id de document. `get` accepte `null` : le code lit partout
 * `state.views.get(state.active)`, qui vaut `undefined` sans onglet actif.
 */
export interface ViewMap extends Map<number, View> {
  get(key: number | null): View | undefined;
}

export interface AppState {
  tabs: TabInfo[];
  /** Document actif ou `null`. */
  active: number | null;
  views: ViewMap;
  /** Documents modifiés sur disque, à re-rendre à l'activation. */
  stale: Set<number>;
}
