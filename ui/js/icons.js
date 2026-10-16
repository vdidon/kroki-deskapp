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

const LOCKED_HINT = "Toujours visible : seul point d'accès à ces réglages";

export const ICON_GROUPS = [
  {
    title: "Barre de la fenêtre",
    // Le conteneur dont les boutons sont pilotés directement par applyIcons.
    container: "tabbar-actions",
    items: [
      { id: "btn-open", label: "Ouvrir", hint: "Ouvrir un fichier (Ctrl+O)", def: true },
      {
        id: "btn-save-session",
        label: "Session",
        hint: "Enregistrer la session (fenêtres et onglets ouverts → .kdws)",
        def: true,
      },
      {
        id: "btn-search",
        label: "Recherche",
        hint: "Rechercher dans les documents ouverts (Ctrl+Maj+F)",
        def: true,
      },
      { id: "btn-refresh", label: "Rafraîchir", hint: "Rafraîchir tous les onglets", def: true },
      { id: "btn-new-window", label: "Nouvelle fenêtre", hint: "Ctrl+Maj+N", def: true },
      { id: "btn-info", label: "Informations", def: true },
      { id: "btn-settings", label: "Réglages", def: true, locked: LOCKED_HINT },
    ],
  },
  {
    title: "Actions du document",
    // Pile flottante : la visibilité finale se décide dans updateViewActions
    // (un bouton activé reste caché si le document ne s'y prête pas).
    container: null,
    items: [
      { id: "btn-toc", label: "Sommaire", def: true },
      { id: "btn-source-toggle", label: "Code source", hint: "Afficher le source du document", def: true },
      {
        id: "btn-derived",
        label: "Markdown intermédiaire",
        hint: "Markdown généré par un plugin de document (.tex…) — outil de mise au point, n'apparaît que sur ces documents",
        def: false,
      },
      { id: "btn-fit-width", label: "Pleine largeur", def: true },
      { id: "btn-export", label: "Export", hint: "Exporter le rendu (page HTML autonome)", def: true },
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
