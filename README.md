# Kroki Desk

Visionneuse Markdown native pour Windows avec rendu de diagrammes intégré,
compatible [Kroki](https://kroki.io) : les blocs de code dont le langage est un
type de diagramme (`mermaid`, `plantuml`, `graphviz`, `svgbob`, `vegalite`, …)
sont rendus en SVG **sans serveur, sans Docker, sans réseau** — les moteurs sont
embarqués dans l'exécutable.

![Tauri 2](https://img.shields.io/badge/Tauri-2-blue) ![Windows](https://img.shields.io/badge/Windows-10%2F11-0078d4)

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
- **Glisser-déposer** de fichiers `.md` depuis l'Explorateur.
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
- **CLI** : `kroki_deskapp.exe "fichier.md" ["autre.md" …]` — instance unique :
  les invocations suivantes ouvrent les fichiers dans la première fenêtre.
  Un fichier peut porter une **référence**, avec la syntaxe des liens :
  `"modele.tex#eq:sigmaU"` (`\label`), `"doc.md#section"`, `"doc.md#L42"`
  (ligne du source) — le document s'ouvre et défile jusqu'à elle. Un nom de
  fichier contenant lui-même `#` reste ouvrable : l'argument entier est essayé
  comme chemin avant d'être coupé au dernier `#`. **`-d`** (`--detach`) relance
  l'application détachée du terminal et rend la main aussitôt :
  `kroki_deskapp -d "doc#ref"` depuis bash (Git Bash, Linux), qui sinon
  ne la rendrait qu'à la fermeture de l'application si elle n'était pas déjà
  ouverte. Pour un agent ou un script, lancer aussi par `start ""
  kroki_deskapp …` (cmd) ou `Start-Process kroki_deskapp` (PowerShell) — le
  MSI enregistre l'application dans *App Paths*, ce qui la rend lançable par
  son nom par ces deux voies, sans PATH. Sous Linux, le `.deb` pose
  `/usr/bin/kroki_deskapp`.
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

⚙ dans la barre d'onglets. Persistés dans
`%APPDATA%\kroki-deskapp\settings.json` :

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

## Build

Prérequis : Rust stable (et WebView2 Runtime, préinstallé sur Windows 10/11).

Des alias Cargo (`.cargo/config.toml`) pilotent le crate `src-tauri/` depuis la
racine du dépôt, sans `cd src-tauri` :

```bash
cargo build-app       # build release → dist/kroki_deskapp-<version>.exe (+ twin non versionné)
cargo run-app         # build + lance l'app en debug (développement)
cargo lint-app        # clippy
cargo fmt-app         # rustfmt
cargo build-appimage  # AppImage Linux (machine/conteneur Linux uniquement)
cargo build-msi       # installeur MSI Windows (Windows uniquement)
cargo build-deb       # paquet Debian/Ubuntu (machine/conteneur Linux uniquement)
```

Le binaire autonome est publié dans `dist/` — un seul fichier : le frontend,
les moteurs JS/WASM, `plantuml-mit.jar` et `ditaa-standalone.jar` y sont
embarqués. Chaque build y dépose l'artefact **postfixé de la version**
(`kroki_deskapp-1.2.3.exe`) plus un fichier **non versionné**
(`kroki_deskapp.exe`) pointant sur le même contenu : hardlink si le système de
fichiers le permet (aucun droit administrateur requis, sur NTFS comme sur
ext4), copie sinon.

### Installeur Windows (MSI)

`cargo build-msi` produit `dist/kroki_deskapp-<version>.msi` (+ twin). Le
binaire portable reste le livrable principal — copiable sur une clé, sans
droits — l'installeur s'y **ajoute** pour qui veut une installation en bonne et
due forme : entrée dans « Applications installées », désinstallation propre,
mise à jour en place d'une version à l'autre, les **associations de fichiers**
et une page de choix des **plugins**.

#### Plugins

Le MSI embarque les plugins listés dans la **stratégie d'embarquement** (cf.
§ « Plugins embarqués » plus bas) ; la seule page de personnalisation laisse
cocher ceux à installer. Ils s'installent au premier lancement et se mettent à
jour en même temps que l'application. Avec la stratégie par défaut :

| Propriété | Plugin | Apporte | Coché |
| --- | --- | --- | --- |
| `PLUGIN_LATEX_DOC` | `latex-doc` | `.tex` `.latex`, fences ` ```latex ` | oui |
| `PLUGIN_CSV_TABLES` | `csv-tables` | `.csv` | non |
| `PLUGIN_BARCHART` | `barchart` | fences ` ```barchart ` | non |
| `PLUGIN_INI_HIGHLIGHT` | `ini-highlight` | coloration ` ```ini ` | non |

Les trois derniers sont les exemples pédagogiques de la spécification du
protocole de plugins : embarqués pour être installables sans réseau, pas pour
être installés par défaut. Un plugin supprimé depuis le dialog Plugins n'est pas
réinstallé, et une version plus récente installée à la main n'est jamais
remplacée par une plus ancienne. Décocher un plugin ne désinstalle pas celui qui
serait déjà en place — la suppression se fait depuis l'application.

#### Associations de fichiers

Elles n'ont pas de page. Seules celles des formats servis par un plugin
dépendent de la case correspondante.

| Extensions | Effet | Installé si |
| --- | --- | --- |
| `.kdws` `.kdext` | double-clic → Kroki Desk | toujours |
| `.md` `.markdown` `.mdown` `.mkd` `.txt` `.html` `.htm` | « Ouvrir avec » | toujours |
| extensions d'un plugin (`.tex` `.latex`, `.csv`…) | double-clic → Kroki Desk | plugin coché |

Installer un plugin, c'est choisir Kroki Desk pour ses formats : l'installeur
les réclame en application par défaut. Windows garde toutefois le dernier mot —
un format pour lequel vous avez déjà choisi une application la conserve, Kroki
Desk n'y apparaît qu'en suggestion. Les formats natifs partagés (Markdown,
texte, HTML) ne sont jamais réclamés : Kroki Desk s'ajoute seulement à « Ouvrir
avec », sans toucher à vos applications par défaut.

#### Installation silencieuse

Les mêmes choix se passent en propriétés :

```
msiexec /i kroki_deskapp.msi /qn PLUGIN_CSV_TABLES=1 PLUGIN_LATEX_DOC=""
```

installe le plugin CSV — et l'association `.csv` avec lui — sans le plugin
LaTeX ni ses associations.

L'installation est **par machine** (`Program Files`), donc élévation demandée.
Les documents, réglages et plugins de chaque utilisateur restent dans son profil
et survivent à une désinstallation.

Le build requiert Windows (WiX v3) et les archives de plugins dans `dist/` —
`python build_dist.py` enchaîne les deux étapes (le MSI fait partie des
artefacts produits par défaut) ; `--msi-only` s'y limite.

### Paquet Debian/Ubuntu (.deb)

`cargo build-deb` produit
`dist/kroki_deskapp-<version>-linux-<arch>-<distro>.deb` (+ twin) : le pendant
Linux du MSI. À installer avec **apt**, qui résout les dépendances — `dpkg -i`
ne le fait pas :

```bash
sudo apt install ./kroki_deskapp-linux-x86_64-debian12.deb
```

Il pose l'application dans `/usr/bin`, l'inscrit au menu des applications,
associe les types de fichiers et se désinstalle proprement
(`sudo apt remove kroki-desk`). Cible : Debian 12+ et Ubuntu 24.04+ — la version
compilée dans le conteneur exige `libc6 (>= 2.36)`, ce qui exclut Ubuntu 22.04.

#### Plugins

Le paquet embarque les mêmes plugins que le MSI, mais un `.deb` n'a pas
d'interface pour vous laisser choisir. Ceux que la stratégie d'embarquement
coche sont donc installés au premier lancement, les autres seulement **déposés
à côté**. Avec la stratégie par défaut :

| Plugin | Apporte | Emplacement dans le paquet | Installé |
| --- | --- | --- | --- |
| `latex-doc` | `.tex` `.latex`, fences ` ```latex ` | `bundled-plugins/` | oui |
| `csv-tables` | `.csv` | `example-plugins/` | non |
| `barchart` | fences ` ```barchart ` | `example-plugins/` | non |
| `ini-highlight` | coloration ` ```ini ` | `example-plugins/` | non |

Les plugins déposés à côté s'installent depuis le dialog Plugins (« Ajouter un
plugin… »), en pointant `/usr/lib/Kroki Desk/example-plugins/` — sans réseau,
puisqu'ils sont déjà là. Les règles de mise à jour sont celles du MSI : jamais
de régression de version, et un plugin supprimé depuis le dialog n'est pas
réinstallé.

#### Associations de fichiers

Kroki Desk s'ajoute à « Ouvrir avec » pour `.md` `.markdown` `.mdown` `.mkd`
`.html` `.htm` et pour les formats des plugins installés de type standard
(`.tex` `.latex`), sans déloger vos applications par défaut. Pour `.kdws`
`.kdext` et les formats propres à un plugin installé — ceux qui n'ont pas de
type MIME standard, et reçoivent un type `text/x-kroki-desk-<ext>` — il est le
seul candidat déclaré, donc le double-clic l'ouvre directement.

Rien n'est imposé : sous Linux, l'application par défaut est un choix
utilisateur (`~/.config/mimeapps.list`) qu'un paquet n'a pas à écrire.

Deux différences avec le MSI, assumées :

- **`.txt` n'est pas associé.** Linux n'a pas d'association par extension :
  `.txt` *est* `text/plain`, et le déclarer ferait apparaître Kroki Desk dans le
  « Ouvrir avec » de tout fichier texte (`.py`, `.conf`, `.log`…), qu'il ne sait
  pas ouvrir. Un `.txt` reste ouvrable par glisser-déposer ou par le sélecteur
  de l'application.
- **Les formats d'un plugin non installé ne sont pas associés** (`.csv` avec la
  stratégie par défaut) : le plugin qui les lit n'est pas là.

Le build requiert Linux et les archives de plugins dans `dist/` —
`python build_dist.py` enchaîne les deux étapes depuis Windows comme depuis
Linux, via Docker (le `.deb` fait partie des artefacts produits par défaut) ;
`--deb-only` s'y limite.

### Plugins embarqués

Les plugins que le MSI et le `.deb` embarquent sont décidés par un fichier
texte à la racine du dépôt, une ligne par plugin :

```
# <id> [on]   — on : coché (MSI) / installé au premier lancement (.deb)
latex-doc      on
csv-tables
```

`bundled-plugins.txt` (ignoré par git) fait foi s'il existe ; sinon
`bundled-plugins.default.txt`, suivi, donne la sélection par défaut. L'ordre
des lignes est celui de la page du MSI. Le nom affiché et les extensions à
associer sont lus dans le `manifest.json` de chaque archive `dist/<id>.kdext`,
qui doit donc exister (`python build_dist.py --plugins-only`). Le fragment WiX
et l'overlay `.deb` qui en découlent sont générés à chaque build ;
`cargo run --manifest-path xtask/Cargo.toml -- bundled` les produit seuls,
pour relecture.

La variable `KROKI_BUNDLED_PLUGINS` (chemin d'un fichier de stratégie) impose
une stratégie précise. C'est ce que fait `python build_dist.py --channel
public` avec `bundled-plugins.default.txt`, même si un `bundled-plugins.txt`
local existe (`--channel local`, le défaut, garde le choix ci-dessus). En canal
public, chaque artefact produit est aussi recopié dans `dist/public/<version>/`,
avec les seuls `.kdext` de la stratégie : c'est le dossier à publier.
`--channel all` enchaîne les deux canaux en une passe (binaires et AppImage
une seule fois, MSI et `.deb` deux fois, public d'abord : `dist/` finit sur
les installeurs du canal local). Le
script s'arrête si les archives réellement embarquées dans le MSI ou le
`.deb` diffèrent de cette stratégie.

### Linux

Support en dégradé (WebKitGTK ; pas de détachement d'onglets inter-fenêtres).
Trois formats livrables :

- **Binaire semi-dynamique** — `cargo build-app` →
  `dist/kroki_deskapp-<version>-linux-<arch>-<distro>` (+ twin non versionné) ;
  la machine cible doit avoir `libwebkit2gtk-4.1` installé.
- **AppImage autonome** — `cargo build-appimage` ; un seul fichier portable,
  GTK/WebKitGTK embarqués →
  `dist/kroki_deskapp-<version>-linux-<arch>-<distro>.AppImage` (+ twin non
  versionné).
- **Paquet `.deb`** — `cargo build-deb` (cf. ci-dessus) ; même binaire que le
  premier, mais installé, associé aux types de fichiers et désinstallable.

`<distro>` est le tag de la distro qui compile (lu dans `/etc/os-release` :
`debian12` pour le conteneur de build, `ubuntu24.04` pour un hôte Ubuntu…) —
un build natif et un build Docker coexistent ainsi dans `dist/` ; le
distribuable est le `-debian12` (glibc bookworm, compatibilité large).
  Installe `tauri-cli` en local (one-shot, `xtask/target/tools/`) s'il n'est
  pas déjà sur le PATH.

L'outillage (Dockerfile, scripts de build et de test) vit dans `scripts/` :

- `scripts/Dockerfile.linux` — image de build `kroki-linux-build` (Debian
  bookworm → AppImage compatible avec les distros plus anciennes) ; commandes
  `docker run` en en-tête du fichier ;
- `scripts/linux_appimage_build.sh` — enrobe `cargo build-appimage` dans le
  conteneur (la publication dans `dist/` est faite par le xtask) ;
- `scripts/linux_deb_build.sh` — idem pour `cargo build-deb` ;
- `scripts/linux_runtime_run.sh` — test runtime headless (Xvfb) ;
- `build_dist.py` (racine du dépôt, cross-plateforme) — génère l'intégralité
  des artefacts de la version en une commande (daemon Docker démarré requis
  pour les étapes Linux) : `.kdext` des plugins + binaire natif de l'hôte +
  installeur MSI (Windows) + AppImage + binaire Linux nu + paquet `.deb` →
  `dist/`, chacun versionné + twin non versionné. **Tout est produit par
  défaut** ; chaque étape se retire par son `--skip-…` (`--skip-plugins`,
  `--skip-native`, `--skip-msi`, `--skip-appimage`, `--skip-binary`,
  `--skip-deb`) ou s'isole par son `--…-only` (`--native-only`,
  `--plugins-only`, `--msi-only`, `--deb-only`) ; s'y ajoutent
  `--skip-image-build`, `--compile-only` et `--test`.

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
- `tests/cdp.mjs` — harnais de test pilotant les webviews via CDP
  (`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`) :
  `report`, `where`, `focus`, `reorder`, `tear-cancel`, `invoke-detach-at x y`.
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
