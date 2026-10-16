# Kroki Desk

Visionneuse Markdown de bureau pour **Windows et Linux**, avec rendu de
diagrammes intégré compatible [Kroki](https://kroki.io) : les blocs de code dont
le langage est un type de diagramme (`mermaid`, `plantuml`, `graphviz`, `d2`,
`svgbob`, `vegalite`, …) sont rendus en SVG **sans serveur, sans Docker, sans
réseau** — les moteurs sont embarqués dans l'exécutable. Extensible par
[plugins](#plugins) : documents LaTeX, CSV, nouveaux types de fences…

![Tauri 2](https://img.shields.io/badge/Tauri-2-blue) ![Windows](https://img.shields.io/badge/Windows-10%2F11-0078d4) ![Linux](https://img.shields.io/badge/Linux-Debian%2012%2B%20%7C%20Ubuntu%2024.04%2B-e95420)

## Installation

| Plateforme | Portable | Installé |
| --- | --- | --- |
| Windows 10/11 | `kroki_deskapp-<version>.exe` | `kroki_deskapp-<version>.msi` |
| Linux x86_64 | `…-linux-x86_64-debian12.AppImage` | `…-linux-x86_64-debian12.deb` |

Les binaires portables tiennent en un fichier, sans installation ni droits.
Les installeurs y ajoutent l'entrée au menu, une désinstallation propre, les
plugins livrés et les **associations de fichiers** : les deux formats propres
à Kroki Desk — `.kdws` (session) et `.kdext` (plugin) — s'ouvrent au
double-clic, Kroki Desk s'ajoute à « Ouvrir avec » pour les formats qu'il lit
nativement (Markdown, HTML…), et chaque plugin installé apporte les
associations de ses propres formats.

Le `.deb` s'installe avec **apt**, qui résout les dépendances (`dpkg -i` ne le
fait pas) :

```bash
sudo apt install ./kroki_deskapp-<version>-linux-x86_64-debian12.deb
```

Détail — choix des plugins dans le MSI, installation silencieuse,
associations par plateforme, binaire Linux nu : [doc/installation.md](doc/installation.md).

## Fonctionnalités

- **Rendu Markdown** style GitHub (tables, listes de tâches, coloration syntaxique,
  ancres de titres, liens relatifs entre fichiers `.md`, images locales).
- **Formules mathématiques** LaTeX en ligne (`$…$`) et en bloc (`$$…$$`), rendues
  par KaTeX embarqué (polices incluses, aucun réseau).
- **Diagrammes intégrés** avec la syntaxe Kroki (alias acceptés : ` ```dot ` →
  graphviz, ` ```c4 ` → c4plantuml, ` ```vega-lite ` → vegalite…) ; les erreurs de
  syntaxe sont affichées dans le document.
- **Documents LaTeX (`.tex`)** — via le plugin `latex-doc` : un article LaTeX
  autonome s'ouvre comme un document normal. Sections numérotées et alimentant
  le sommaire, formules rendues par KaTeX, équations numérotées, théorèmes
  `amsthm` (compteurs partagés compris), **références croisées `\ref`/`\eqref`
  cliquables**, macros `\newcommand` du préambule expansées, tables et listes.
  Une fence ` ```latex ` dans un `.md` reçoit le même rendu. Le rendu est
  sémantique : la mise en page LaTeX (pagination, flottants, colonnes) n'est
  pas reproduite, et les documents multi-fichiers (`\input`) et la bibliographie
  ne sont pas pris en charge. Les figures TikZ sont dessinées si une
  distribution TeX est installée sur le poste (cf. moteur `tikz`).
- **Vue code source** (`</>`, pile d'actions de vue) : le fichier tel qu'il est
  sur le disque, numéroté et **coloré** — Markdown, `.tex`/`.latex`
  et les formats des plugins qui fournissent une grammaire ; un format sans grammaire s'affiche en texte brut. La
  bascule preview ↔ source conserve la position de lecture.
- **Onglets** : plusieurs fichiers par fenêtre, réordonnables à la souris,
  fermeture par clic molette ou `Ctrl+W`.
- **Multi-fenêtres** : `Ctrl+Maj+N`, ou en **détachant un onglet** — glissez un
  onglet hors de la barre pour le sortir dans sa propre fenêtre, déposez-le sur une
  autre fenêtre de l'application pour l'y rattacher (comme un navigateur).
  Le détachement par glisser est propre à Windows ; sous Linux, les onglets se
  réordonnent dans leur fenêtre.
- **Glisser-déposer** de fichiers depuis le gestionnaire de fichiers (et, sous
  Windows, depuis un éditeur comme VS Code).
- **Recherche dans le document** (`Ctrl+F`) : barre compacte dans le coin
  haut-droit de la zone de lecture — compteur `n/m`, occurrence précédente /
  suivante (`Entrée`, `Maj+Entrée`, `F3`), fermeture. Toutes les occurrences
  sont surlignées, la courante dans une teinte contrastée. La recherche porte
  sur ce qui est affiché : elle suit le mode courant (preview, code source,
  markdown intermédiaire).
- **Recherche dans tous les documents ouverts** : la loupe de la barre
  d'onglets (ou `Ctrl+Maj+F`) cherche le texte tapé dans le source de chaque
  onglet ; résultats groupés par document avec numéro de ligne et extrait, un
  clic active l'onglet, scrolle vers la ligne et surligne les occurrences dans
  la vue.
- **Options de recherche**, communes aux deux : `Aa` respecter la casse, `ab`
  mot entier, `.*` expression régulière — collées à droite du champ, comme dans
  un éditeur. « Mot entier » reconnaît les lettres accentuées (`été`,
  `naïve`) ; un motif invalide passe le champ en rouge.
- **Rechargement automatique** quand le fichier change sur disque.
- **Export HTML** : la flèche de téléchargement (pile d'actions de vue)
  enregistre le rendu de l'onglet actif en page HTML autonome — styles inlinés,
  diagrammes en SVG, images locales en data-URI — consultable dans n'importe
  quel navigateur, sans l'application ni réseau. Les fichiers `.html`/`.htm`
  (dont ces exports) s'ouvrent aussi dans Kroki Desk : la page est affichée
  telle quelle dans un onglet, via une iframe sandboxée (aucun script exécuté).
- **Sessions `.kdws`** : le bouton « pile » de la barre d'onglets enregistre
  l'état courant (toutes les fenêtres, onglets dans l'ordre, onglet actif) dans
  un fichier JSON portable ; le rouvrir (drag-drop, dialogue Ouvrir, CLI, ou
  double-clic — l'installeur associe `.kdws` à l'application) restaure le tout — la
  première fenêtre de la session dans la fenêtre cible, les suivantes dans des
  fenêtres neuves. Chemins relatifs résolus depuis le dossier du `.kdws`
  (séparateur `/`, éditable à la main, committable à côté des documents) ;
  fichiers manquants ignorés et signalés. L'application ne restaure jamais rien
  automatiquement au démarrage : rouvrir une session est toujours un geste
  explicite.
- **CLI** : `kroki_deskapp "fichier.md" ["autre.md" …]` — instance unique :
  les invocations suivantes ouvrent les fichiers dans la première fenêtre.
  Un fichier peut porter une **référence**, avec la syntaxe des liens :
  `"modele.tex#eq:sigmaU"` (`\label`), `"doc.md#section"`, `"doc.md#L42"`
  (ligne du source) — le document s'ouvre et défile jusqu'à elle. Un nom de
  fichier contenant lui-même `#` reste ouvrable : l'argument entier est essayé
  comme chemin avant d'être coupé au dernier `#`. **`-d`** (`--detach`) relance
  l'application détachée du terminal et rend la main aussitôt :
  `kroki_deskapp -d "doc#ref"` depuis bash (Git Bash, Linux), qui sinon
  ne la rendrait qu'à la fermeture de l'application si elle n'était pas déjà
  ouverte. Installée, l'application se lance par son nom sans toucher au PATH
  (`start ""`/`Start-Process` sous Windows, `/usr/bin` sous Linux — cf.
  [installation](doc/installation.md#lancement-par-nom)).
- **API Kroki locale** (optionnelle, activée par défaut sur
  `http://127.0.0.1:8442`) : expose le rendu intégré aux outils tiers —
  extensions VS Code, scripts… Routes : `POST /` (JSON), `POST /{type}/svg`
  (texte brut), `GET /{type}/svg/{deflate+base64url}`, `GET /health` et
  `GET /v1/health` (compat Kroki : `{"status":"pass","version":{…}}`, lu par
  l'extension `markdown-kroki` à l'activation pour connaître les types rendus).
- **Zoom texte** : `Ctrl+molette`, `Ctrl+=` / `Ctrl+-` — le texte grossit et
  reflue dans la colonne, une figure pleine largeur garde sa taille.
- **Zoom de page** : `Maj+molette`, autour du curseur — vrai zoom, sans
  reflux : tout grossit, la page déborde en défilement horizontal, ce qui
  permet de parcourir une figure trop dense pour tenir en un écran.
  `Ctrl+0` remet les deux zooms à 1.

## Moteurs de rendu intégrés

| Famille | Types | Exécution |
|---|---|---|
| JS / WASM | mermaid, graphviz (+`dot`), **d2**, **bpmn**, **excalidraw**, vega, vegalite, nomnoml, wavedrom, bytefield | webview dédiée invisible |
| JS → graphviz | **dbml**, **erd** (génèrent du DOT, rendu par le graphviz embarqué) | webview dédiée invisible |
| Natif Rust | svgbob, pikchr | dans le processus |
| JVM | plantuml, c4plantuml (stdlib C4 incluse), ditaa | `plantuml-mit.jar` et `ditaa-standalone.jar` embarqués, extraits et exécutés **si Java est présent** sur le poste |
| TeX | **tikz** | compilé par la distribution TeX du poste (`latex` + `dvisvgm`, MiKTeX ou TeX Live) **si elle est présente** — rien n'est embarqué |
| JS « live » | **plotly** (graphiques interactifs) | dans la vue affichée, pas de SVG figé |

Types Kroki **non** embarqués — ils dépendent d'un runtime Python
(blockdiag/seqdiag/actdiag/nwdiag/rackdiag/packetdiag, wireviz, symbolator), ou
n'ont pas de portage exploitable (structurizr, umlet,
diagramsnet) : un message explicite s'affiche ; un **serveur Kroki
externe** peut être configuré dans les réglages (⚙) pour les couvrir — il prend
alors en charge tous les rendus.

> **excalidraw** : rendu via `@excalidraw/excalidraw` (`exportToSvg`). Les polices
> manuscrites (Excalifont, ~14 Mo) ne sont **pas** embarquées pour garder le binaire
> raisonnable ; le texte est rendu avec une police système (lisible, non manuscrite).

> **plotly** : seul moteur **interactif** (survol, zoom, pan). Contrairement aux
> diagrammes Kroki rendus en SVG figé, il s'exécute dans la vue affichée. Un bloc
> ` ```plotly ` contient soit une spec JSON Plotly (`{data, layout}`) inline, soit
> `src=chemin.json` (lu relativement au document) pour garder le `.md` léger. Le
> bundle `vendor/plotly.min.js` (~4,8 Mo) est chargé à la demande, à la première
> figure rencontrée.

## Raccourcis

La même liste est rappelée sur l’écran d’accueil de l’application (fenêtre sans
onglet ouvert).

| Raccourci | Action |
|---|---|
| `Ctrl+O` | Ouvrir un fichier |
| `Ctrl+W` | Fermer l'onglet (puis la fenêtre s'il n'y a plus d'onglet) |
| `Ctrl+Tab` / `Ctrl+Maj+Tab` | Onglet suivant / précédent |
| `Ctrl+Maj+N` | Nouvelle fenêtre |
| `Ctrl+F` | Rechercher dans le document affiché (`Échap` ferme) |
| `Entrée` / `Maj+Entrée`, `F3` / `Maj+F3`, `Ctrl+G` | Occurrence suivante / précédente |
| `Ctrl+Maj+F` | Rechercher dans tous les documents ouverts (`Échap` ferme) |
| `F5` / `Ctrl+R` | Recharger le document |
| `Ctrl+=` / `Ctrl+-`, `Ctrl+molette` | Zoom texte (reflue) |
| `Maj+molette` | Zoom de page autour du curseur (vrai zoom, défilement horizontal) |
| `Ctrl+0` | Remettre les deux zooms à 1 |

## Réglages

⚙ dans la barre d'onglets. Persistés dans `settings.json`, sous
`%APPDATA%\kroki-deskapp\` (Windows) ou `~/.config/kroki-deskapp/` (Linux) :

- **Serveur Kroki externe** (vide = rendu intégré, recommandé) ;
- **API Kroki locale** : activation + port (8442 par défaut) ;
- **Icônes affichées** : quelles icônes garder dans la barre de la fenêtre et
  dans la pile d'actions du document. Réglage commun à toutes les fenêtres ;
  seules les cases explicitement cochées ou décochées sont enregistrées, les
  autres suivent leur défaut (« Réinitialiser » rend la main aux défauts).
  L'icône ⚙ reste toujours visible, et masquer une icône ne désactive pas son
  raccourci clavier. Le bouton **« markdown intermédiaire »** — la sortie brute
  d'un plugin de document (`.tex`…), utile à la mise au point
  d'un plugin — s'active ici ; il est désactivé par défaut.

## Plugins

Un plugin ajoute un format de document (`.tex`, `.csv`…), un type de fence ou
une coloration syntaxique. Il s'exécute dans un worker isolé, sans accès au
disque hors du dossier du document ouvert. Il se distribue en archive `.kdext`,
à installer par glisser-déposer sur la fenêtre, double-clic ou dialog
Plugins (⚙), après confirmation.

Plugins du dépôt (`plugins/`) :

- [`latex-doc`](plugins/latex-doc/README.md) — documents LaTeX autonomes et
  fences ` ```latex ` (installé par défaut avec les installeurs) ;
- [`csv-tables`](plugins/csv-tables/README.md),
  [`barchart`](plugins/barchart/README.md),
  [`ini-highlight`](plugins/ini-highlight/README.md) — exemples pédagogiques,
  un par point d'extension.

Écrire un plugin : [doc/plugin-protocol.md](doc/plugin-protocol.md) (protocole
v1, exemples commentés, empaquetage par `python pack_plugin.py`).

## Build

Prérequis minimal : Rust stable. Il n'y a pas de bundler frontend, aucune étape
`npm`.

```bash
cargo run-app            # développement : build debug + lancement
cargo build-app          # binaire release de l'hôte → dist/
python build_dist.py     # tous les artefacts de la version → dist/
```

`build_dist.py` (Python 3.10+, sans dépendance) est la voie de référence pour
produire une version : plugins, binaire natif, MSI sous Windows, puis AppImage,
binaire Linux et `.deb` via Docker. Chaque étape se retire par son `--skip-…`
ou s'isole par son `--…-only`.

Détail — prérequis par plateforme, options, nommage des artefacts, plugins
embarqués dans les installeurs, outillage Linux, tests :
[doc/building.md](doc/building.md).

## Architecture

- `src-tauri/` — backend Rust (Tauri 2) :
  - `engine.rs` : dispatch du rendu intégré (natif / webview / JVM) ;
  - `server.rs` : API HTTP locale compatible Kroki (tiny_http) ;
  - `manager.rs` : fenêtres, onglets, détachement/rattachement
    (`WindowFromPoint` Win32 au relâchement) ;
  - `watcher.rs` : rechargement automatique (notify) ;
  - `kroki.rs` : client du serveur externe optionnel + cache des rendus ;
  - `assets/plantuml-mit.jar` : PlantUML (licence MIT) embarqué via `include_bytes!` ;
  - `assets/ditaa-0.11.0-standalone.jar` : ditaa (licence LGPL v3, Batik inclus pour
    la sortie `--svg`) embarqué via `include_bytes!`, exécuté en sous-process.
- `ui/` — frontend statique embarqué (aucun bundler) :
  - markdown-it + fences Kroki, highlight.js, DOMPurify pour le HTML des documents ;
  - `vendor/katex/` : KaTeX + ses polices `.woff2` et le plugin markdown-it-texmath
    (`$…$` / `$$…$$`), rendu math local sans réseau ni `eval` ;
  - `renderer/` : page de la webview de rendu et ses moteurs vendorés
    (mermaid, graphviz WASM, d2 WASM, bpmn-js, vega + interpréteur sans `eval`,
    nomnoml, wavedrom, bytefield-svg). `vendor/dbml.js` est un bundle esbuild de
    `@softwaretechnik/dbml-renderer` réduit à `run(src, "dot")` (viz.js exclu) :
    il produit du DOT, rendu ensuite par le graphviz WASM déjà chargé.
- `plugins/` — plugins du dépôt (cf. [Plugins](#plugins)) ; l'hôte côté Rust
  (`src-tauri/src/plugins.rs`) ne fait que scanner, installer et confiner,
  le code des plugins tourne dans des workers (`ui/js/plugins.js`).
- `xtask/`, `scripts/`, `build_dist.py` — build et publication des artefacts
  (cf. [doc/building.md](doc/building.md)).
- `tests/` — scripts Node pilotant l'application via CDP, et suites autonomes.
- `doc/` — [installation](doc/installation.md), [build](doc/building.md),
  [protocole de plugins](doc/plugin-protocol.md).
- `samples/` — documents de démonstration (`demo.md`, `moteurs.md`).

### Notes de sécurité

Le HTML inline des documents passe par DOMPurify. Les SVG produits par les
moteurs sont insérés tels quels (DOMPurify viderait les `<foreignObject>` des
labels mermaid) : la CSP de l'application (aucun `'unsafe-inline'`) neutralise
tout script ou gestionnaire d'événement embarqué — un `<script>` injecté via
innerHTML ne s'exécute pas, et aucun code de l'app n'`eval()` le contenu des
documents.

La CSP autorise `'unsafe-eval'` et les workers `blob:` : c'est requis par le
moteur **d2**, dont le runtime WASM utilise `new Function` dans un *module
worker*. Cela n'ouvre pas de faille côté document (pas de sink `eval` alimenté
par du contenu non fiable, scripts injectés non exécutés) ; le seul `eval` réel
est interne à d2, confiné à la webview de rendu — la même confiance que celle
déjà accordée aux moteurs mermaid/PlantUML/graphviz. L'API locale n'écoute que
sur 127.0.0.1.
