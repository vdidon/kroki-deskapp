// Icônes des barres d'outils : registre, défauts, visibilité effective.
//
// Réglage global (persisté par le backend dans `settings.json`) mais
// **partiel** : la map ne contient que les icônes explicitement cochées ou
// décochées par l'utilisateur. Toute icône absente suit le `def` ci-dessous —
// un défaut qui changerait dans une version ultérieure s'appliquerait donc aux
// postes qui n'y ont jamais touché, sans jamais écraser un choix fait.
//
// Les icônes de la barre de fenêtre sont masquées ici même ; celles de la pile
// d'actions de vue dépendent en plus du document affiché (cf.
// `updateViewActions` dans main.js), qui interroge `iconEnabled`.

import { t } from "./i18n.js";

// Libellés, indications et titres de groupe sont des fonctions : résolus au
// moment d'afficher (dialog Réglages, reconstruit à chaque changement de
// langue), jamais figés à l'import. `locked` : indication commune
// (`icons.locked_hint`, ajoutée par settings.js).
export const ICON_GROUPS = [
  {
    title: () => t("icons.group.window"),
    // Le conteneur dont les boutons sont pilotés directement par applyIcons.
    container: "tabbar-actions",
    items: [
      {
        id: "btn-open",
        label: () => t("icons.open.label"),
        hint: () => t("icons.open.hint"),
        def: true,
      },
      {
        id: "btn-save-session",
        label: () => t("icons.session.label"),
        hint: () => t("icons.session.hint"),
        def: true,
      },
      {
        id: "btn-search",
        label: () => t("icons.search.label"),
        hint: () => t("icons.search.hint"),
        def: true,
      },
      {
        id: "btn-refresh",
        label: () => t("icons.refresh.label"),
        hint: () => t("icons.refresh.hint"),
        def: true,
      },
      {
        id: "btn-new-window",
        label: () => t("icons.new_window.label"),
        hint: () => t("icons.new_window.hint"),
        def: true,
      },
      { id: "btn-info", label: () => t("icons.info.label"), def: true },
      { id: "btn-settings", label: () => t("icons.settings.label"), def: true, locked: true },
    ],
  },
  {
    title: () => t("icons.group.document"),
    // Pile flottante : la visibilité finale se décide dans updateViewActions
    // (un bouton activé reste caché si le document ne s'y prête pas).
    container: null,
    items: [
      { id: "btn-toc", label: () => t("icons.toc.label"), def: true },
      {
        id: "btn-source-toggle",
        label: () => t("icons.source.label"),
        hint: () => t("icons.source.hint"),
        def: true,
      },
      {
        id: "btn-derived",
        label: () => t("icons.derived.label"),
        hint: () => t("icons.derived.hint"),
        def: false,
      },
      { id: "btn-fit-width", label: () => t("icons.fit_width.label"), def: true },
      {
        id: "btn-export",
        label: () => t("icons.export.label"),
        hint: () => t("icons.export.hint"),
        def: true,
      },
    ],
  },
];

const BY_ID = new Map(ICON_GROUPS.flatMap((g) => g.items.map((it) => [it.id, it])));

let overrides = {}; // id -> bool, uniquement les choix explicites de l'utilisateur

/** Visibilité voulue pour une icône : choix explicite, sinon défaut du registre. */
export function iconEnabled(id) {
  const it = BY_ID.get(id);
  if (!it) return true; // icône hors registre : jamais masquée par ce réglage
  if (it.locked) return true;
  return overrides[id] ?? it.def;
}

/**
 * Applique une map de choix explicites : mémorise, puis masque/affiche les
 * boutons des barres à conteneur fixe. Les actions de vue sont réévaluées par
 * l'appelant (updateViewActions), qui seul connaît l'état du document.
 */
export function applyIcons(map) {
  overrides = { ...(map || {}) };
  for (const group of ICON_GROUPS) {
    if (!group.container) continue;
    for (const it of group.items) {
      const el = document.getElementById(it.id);
      if (el) el.hidden = !iconEnabled(it.id);
    }
  }
}
