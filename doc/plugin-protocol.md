# Protocole de plugins Kroki Desk — spécification v1

> **Statut : spécification de conception, non implémentée.**
> Ce document fige le contrat *avant* la première ligne de code, pour que les
> plugins écrits contre la v1 restent compatibles avec les extensions futures
> (webview, processus natifs) déjà réservées ici.

## 1. Objectif et principes

Un **plugin** ajoute à Kroki Desk la prise en charge :

- d'un **type de fichier** (extension, ex. `.tex`) — transformé en markdown
  rendu par l'hôte ;
- et/ou d'un **langage de fence** (ex. ` ```plotly `) dans n'importe quel
  document markdown — natif ou dérivé d'un autre plugin.

Principes non négociables :

1. **Un protocole, pas une API.** Le plugin ne lie aucune bibliothèque de
   l'application : hôte et plugin échangent des **messages JSON** à travers une
   frontière d'isolation. On peut ajouter des champs et des méthodes sans
   casser l'existant ; les capacités sont négociées, jamais supposées.
2. **Sandbox par défaut.** Un plugin v1 tourne dans un **Web Worker** : pas
   d'accès au DOM de l'application, pas d'accès à `invoke` (commandes Tauri),
   pas de réseau (CSP), pas de disque. Tout besoin externe passe par un
   service de l'hôte, accordé capacité par capacité.
3. **La sortie d'un plugin est du contenu, jamais du code.** En v1, un plugin
   produit du markdown, du SVG ou du HTML — qui repassent par le pipeline de
   confiance existant (markdown-it, DOMPurify, CSP). Les modes où le plugin
   fournit du code exécutable (`*:webview`, runtime `process`) sont **réservés**
   et non implémentés.
4. **Le natif gagne toujours.** Un plugin ne peut pas s'approprier une
   extension ou une fence déjà gérée nativement (`.md`, `mermaid`, `plotly`…) :
   la revendication est ignorée avec avertissement (§ 8).
5. **Ne jamais casser le rendu.** Un
   plugin doit dégrader (bandeau + source en fence) plutôt que lever sur un
   contenu invalide. Une erreur de *protocole* (crash, timeout) est gérée par
   l'hôte : bandeau d'erreur + source brut affiché (§ 7.3).

## 2. Format de distribution : archive `.kdext`

Un plugin est un fichier zip d'extension `.kdext` :

```
mon-plugin-1.2.0.kdext
├── manifest.json        # obligatoire, à la racine
├── main.js              # point d'entrée (module ES exécuté dans le worker)
├── CHANGELOG.md         # optionnel : journal des modifications (§ 3.1)
└── …                    # assets libres : .wasm, données, chargés par main.js
```

Le JS d'entrée peut être trivial : la logique peut vivre dans un module WASM
embarqué dans l'archive (Rust, Go, C… compilés vers WASM) — c'est **le** chemin
officiel des langages compilés, aucun support protocolaire supplémentaire
n'est requis. `main.js` charge le `.wasm` via une URL relative à l'archive,
résolue par l'hôte.

L'outillage d'empaquetage (`pack_plugin.py` à la racine du dépôt) reconnaît
un champ optionnel **`packInclude`** dans le manifeste : la liste explicite
des fichiers à embarquer dans l'archive (chemins relatifs POSIX, ex.
`"vendor/highlight.esm.js"`) — `manifest.json` et l'`entry` sont toujours
inclus d'office, un chemin introuvable est une erreur, champ absent = tout
le dossier du plugin. C'est un champ **d'empaquetage uniquement** : l'hôte
l'ignore (règle des champs inconnus, § 3), il ne fait pas partie du protocole.

## 3. Manifeste (`manifest.json`)

```json
{
  "manifestVersion": 1,
  "id": "spec-doc",
  "version": "3.1.0",
  "apiVersion": "1",
  "name": "Spec documents",
  "description": "Rendu des fichiers .spec",
  "publisher": "acme",
  "runtime": "worker",
  "entry": "main.js",
  "extensions": [".spec"],
  "fences": ["spec"],
  "highlights": ["spec-source"],
  "capabilities": ["document:markdown", "fence:markdown", "read:siblings", "highlight:code"],
  "siblingExtensions": [".spec", ".json"]
}
```

| Champ | Oblig. | Rôle |
| --- | --- | --- |
| `manifestVersion` | ✔ | Version du **schéma du manifeste** (entier). L'hôte refuse un majeur inconnu. |
| `id` | ✔ | Identifiant stable `[a-z0-9-]+`, unique : c'est la clé d'installation/mise à jour. |
| `version` | ✔ | Version **du plugin** (semver). Affichée ; « remplace » à l'installation. |
| `apiVersion` | ✔ | Majeur du **protocole** requis (`"1"`). L'hôte refuse s'il ne le supporte pas. |
| `name`, `description`, `publisher` | ✔ | Affichage (dialog d'installation, liste des plugins). |
| `runtime` | ✔ | `"worker"` (seule valeur v1). `"process"` **réservé** (§ 10.2). |
| `entry` | ✔ | Chemin du module d'entrée dans l'archive. |
| `extensions` |  | Extensions de fichier revendiquées (avec le point, insensible à la casse). Requiert une capacité `document:*`. |
| `fences` |  | Langages de fence revendiqués (minuscules). Requiert une capacité `fence:*`. |
| `highlights` |  | Langages de coloration revendiqués. Requiert `highlight:code`. Le nom `<ext>-source` (ou `<ext>`) est celui que l'hôte demande pour la vue « code source » d'un document servi par ce plugin (§6.4). |
| `capabilities` | ✔ | Liste de chaînes, cf. § 4. Une capacité inconnue de l'hôte est **ignorée** (compat ascendante) ; une capacité connue mais non implémentée rend le plugin inerte avec le message « requiert une version plus récente de Kroki Desk ». |
| `siblingExtensions` |  | Allowlist d'extensions pour `host/readFile` (défaut : aucune). Affichée dans le dialog de confiance. |

Règle de compat : **tout champ inconnu du manifeste est ignoré** — un manifeste
écrit pour un hôte plus récent reste chargeable par un hôte ancien tant que
`manifestVersion` et `apiVersion` sont satisfaits.

### 3.1 Fichier conventionnel optionnel : `CHANGELOG.md`

Un plugin peut embarquer un **journal des modifications** : un fichier
markdown nommé exactement `CHANGELOG.md`, à la racine de l'archive. C'est une
**convention de nommage**, pas un champ de manifeste — un hôte qui ne la
connaît pas ignore simplement le fichier, aucune compatibilité n'est en jeu.

- S'il est présent, la carte du plugin dans le dialog de gestion (§ 9.4)
  gagne un bouton **« Nouveautés »** qui l'affiche dans le dialog changelog
  de l'hôte.
- Le rendu est fait **par l'hôte** (markdown-it + DOMPurify, liens externes
  déroutés vers le navigateur système) : le code du plugin ne s'exécute pas,
  et les fences de diagrammes n'y sont **pas** hydratées — c'est de la prose.
- Format recommandé : [Keep a Changelog](https://keepachangelog.com/fr/),
  de la version la plus récente à la plus ancienne. Un titre `# …` de tête
  est retiré à l'affichage (redondant avec l'en-tête du dialog), de même que
  les définitions de liens de référence pointant vers des ancres internes
  (`[1.2.0]: #120--…`).

| Capacité | Statut v1 | Description |
| --- | --- | --- |
| `document:markdown` | **implémentée** | Transforme un document entier en markdown dérivé + ancres (§ 6.2). Le pipeline aval (moteurs Kroki, sommaire, vue source, thème, recherche) est gratuit. |
| `fence:svg` | **implémentée** | Rend un bloc fence en SVG statique, inséré tel quel (la CSP — `script-src 'self'`, pas d'inline — neutralise tout script, même politique que les SVG des moteurs natifs, cf. `render.js`). |
| `fence:html` | **implémentée** | Rend un bloc fence en HTML statique, **sanitizé DOMPurify** avant insertion (profil de `sanitizeHtml`, `render.js` — les `<foreignObject>` ne survivent pas : produire du SVG pur si besoin). |
| `fence:markdown` | **implémentée** | Rend un bloc fence en **markdown dérivé**, repassé dans le pipeline complet de l'hôte (markdown-it + DOMPurify) puis hydraté récursivement : les fences Kroki natives et les colorations plugin qu'il contient sont rendues. Profondeur d'imbrication bornée (2) ; les `data-source-line` du contenu dérivé sont retirés (pas de remapping pour une fence). |
| `highlight:code` | **implémentée** | Colore le code d'une fence déclarée dans `highlights` : le plugin retourne du HTML `<span class="hljs-…">`, sanitizé, stylé par le thème hljs de l'hôte. Remplace l'enregistrement direct d'une grammaire hljs (impossible sans exécuter du code plugin dans la webview principale). |
| `read:siblings` | **implémentée** | Service `host/readFile` : lecture de fichiers **relatifs au dossier du document**, même confinement que `read_data_file` (`commands.rs`) — rejet des chemins absolus, canonicalisation + `starts_with` anti-traversée/symlink, allowlist `siblingExtensions`. |
| `document:html` | *réservée* | Document entier → HTML statique sanitizé (mise en page libre, sans JS). |
| `document:webview` | *réservée* | Document entier → vue HTML/CSS/JS dans une iframe sandboxée (`allow-scripts`, sans `allow-same-origin`), communication `postMessage`. Modèle « custom editor » VS Code. |
| `fence:webview` | *réservée* | Bloc interactif en iframe sandboxée (cas Plotly : runtime JS vivant dans la page). |

Un plugin peut combiner librement (ex. `document:markdown` + `fence:svg` +
`highlight:code`).

**Cas Plotly (motivation de `fence:webview`)** : la branche `plotly` de
`hydrateDiagrams` (`ui/js/render.js`) est le prototype natif d'un fence
handler interactif — interception avant le backend, runtime chargé
paresseusement, `src=` lu via `read_data_file`, image de fallback masquée en
cas de succès. Plotly **reste natif** ; le protocole réserve simplement la
case pour qu'une migration future (ou un autre runtime interactif) n'exige
aucune rupture. Le jour où la branche native est retirée, un plugin `plotly`
prend le relais sans changement de protocole (§ 8).

## 5. Enveloppe des messages

Transport v1 : `postMessage` entre l'hôte (webview principale) et le worker du
plugin. Chaque message est un objet JSON :

```jsonc
// requête (dans les deux sens)
{ "kd": 1, "id": 42, "method": "document/transform", "params": { … } }
// réponse — exactement l'un des deux champs
{ "kd": 1, "id": 42, "result": { … } }
{ "kd": 1, "id": 42, "error": { "code": "internal", "message": "…" } }
// notification (pas de réponse attendue)
{ "kd": 1, "method": "host/log", "params": { "level": "warn", "message": "…" } }
```

- `kd: 1` = version d'enveloppe ; `id` corrèle requête/réponse, chaque côté a
  son propre espace d'ids.
- **Champs inconnus ignorés** dans `params` et `result` — c'est le levier
  principal d'évolution sans rupture. Une *méthode* inconnue reçoit
  `error.code = "method-not-found"`.
- `error.code` (chaîne) : `internal`, `method-not-found`, `not-supported`,
  `timeout`, `denied`, `not-found` — extensible.

## 6. Cycle de vie et méthodes

### 6.1 Initialisation (hôte → plugin)

Le worker est démarré **paresseusement** : au premier document/fence dont le
plugin a la charge (pas au boot — même logique d'amortissement que la webview
renderer, mais inversée : on ne paie que si on s'en sert).

```jsonc
// hôte → plugin
{ "method": "initialize", "params": {
    "apiVersion": "1",
    "hostVersion": "2.9.1",              // CARGO_PKG_VERSION
    "capabilities": ["document:markdown", "fence:svg", "fence:html",
                      "fence:markdown", "highlight:code", "read:siblings"],   // ce que CET hôte sait servir
    "theme": "dark"                       // thème effectif courant : "light" | "dark"
} }
// plugin → hôte
{ "result": { "ok": true } }
```

L'intersection `manifest.capabilities ∩ params.capabilities` définit ce qui est
actif. Un plugin dont aucune capacité n'est servable est marqué « inerte »
dans la liste des plugins, avec la raison.

`shutdown` (hôte → plugin, notification) précède la terminaison du worker ;
l'hôte peut aussi tuer le worker sans préavis (crash, timeout, désinstallation)
— un plugin ne doit détenir aucun état précieux (§ 7.2).

### 6.2 `document/transform` — capacité `document:markdown`

Transforme un document entier en markdown, rendu ensuite par l'hôte comme un
`.md` (intégration : `renderActive`, `ui/js/main.js`).

```jsonc
// hôte → plugin
{ "method": "document/transform", "params": {
    "text": "…source intégral…",
    "path": "D:\\docs\\pricing.spec",  // chemin absolu (deep-links inter-fichiers)
    "dir":  "D:\\docs",                // dossier (base de host/readFile)
    "title": "pricing",                // nom de fichier sans extension
    "theme": "dark"
} }
// plugin → hôte
{ "result": {
    "markdown": "# pricing\n\n```graphviz\n…",
    "anchors": [[0, 0], [12, 4], …],   // [ligneMarkdown, ligneSource], triées,
                                        // sémantique de remapLine (ui/js/anchors.js) :
                                        // la ligne source de l'ancre dont la ligne
                                        // markdown est la plus grande ≤ demandée
    "warnings": ["import « x.spec » introuvable"]   // optionnel, affichés en bandeau
} }
```

Contrat de robustesse : un **contenu** invalide ne produit jamais `error` —
le plugin retourne un markdown dégradé (bandeau + source en fence). `error` est réservé aux pannes internes ; l'hôte
affiche alors son propre bandeau et le source brut en fence (§ 7.3).

Le rechargement par le watcher ré-émet simplement `document/transform` — un
appel par rendu, sans état de session côté protocole.

### 6.3 `fence/render` — capacités `fence:svg` / `fence:html` / `fence:markdown`

Appelée par `hydrateDiagrams` pour chaque fence revendiquée, en parallèle des
rendus natifs.

```jsonc
// hôte → plugin
{ "method": "fence/render", "params": {
    "lang": "musicxml",
    "source": "…contenu du bloc (peut être vide si options.src)…",
    "options": { "src": "partition.xml" },  // key=value de l'info string,
                                             // syntaxe de parseDiagramOptions (render.js)
    "dir": "D:\\docs",
    "theme": "dark"
} }
// plugin → hôte
{ "result": { "format": "svg", "content": "<svg …>…</svg>" } }
// ou { "format": "html", "content": "<table …>…" }   // sanitizé DOMPurify
// ou { "format": "markdown", "content": "## …" }     // pipeline complet
```

`format: "markdown"` (capacité `fence:markdown`) : le contenu est rendu par le
markdown-it de l'hôte (+ DOMPurify) puis **hydraté récursivement** — fences
Kroki natives et colorations `highlight:code` incluses. Garde-fous hôte : la
profondeur d'imbrication est bornée à 2 (un plugin dont le markdown dérivé
contient une fence `fence:markdown` ne boucle pas — au-delà, bloc d'erreur
standard) et les `data-source-line` du contenu dérivé sont retirés (ils
pointeraient dans le markdown généré, pas dans le document ouvert ; pas
d'ancres/remapping pour une fence, contrairement à `document/transform`).

Services rendus par l'hôte, sans action du plugin :

- placeholder « Rendu {lang}… » pendant l'appel, bloc d'erreur standard
  (`diagramError`) si `error` ;
- **image de fallback jumelle** : si `options.src` est présent et que le rendu
  réussit, l'hôte applique la logique `hidePairedFallbackImage` (`render.js`)
  — une image précédant immédiatement le bloc avec le même *stem* est masquée.
  Généralisation du comportement Plotly, gratuite pour tout fence handler.

### 6.4 `highlight/render` — capacité `highlight:code`

```jsonc
{ "method": "highlight/render", "params": { "lang": "spec-source", "code": "count = …" } }
{ "result": { "html": "<span class=\"hljs-keyword\">…</span>…" } }
```

L'hôte sanitize (balises `span`/classes uniquement) et injecte dans le `<code>`
de la fence ; les classes `hljs-*` héritent du thème hljs actif (rappel projet :
palette par **concept métier**, pas par famille technique). En cas d'`error`,
la fence reste non colorée — jamais bloquante.

**Vue « code source ».** L'hôte demande aussi cette méthode pour colorer le
source brut d'un document transformé, quand le plugin revendique la grammaire du
**fichier entier** — convention `<ext>-source` (`tex-source` pour `.tex`), sinon `<ext>` en repli. La convention part
de l'**extension**, pas du nom du langage : un plugin servant plusieurs
extensions déclare autant de noms pour la même grammaire (latex-doc revendique
`tex-source` **et** `latex-source`). Deux conséquences côté plugin :

- le `code` reçu est alors le **document complet**, déclarations comprises, pas
  un fragment de fence — d'où une grammaire éventuellement distincte de celle
  des fences ;
- la réponse doit rester dans le budget de 5 s (§7.1) même sur un gros fichier ;
  au-delà, l'hôte laisse simplement la vue en texte brut.

La coloration est appliquée **ligne par ligne** (une `div` par ligne du source,
pour l'alignement avec le preview) : l'hôte recoupe le HTML retourné à chaque
`\n` en rééquilibrant les `span` à cheval, et abandonne silencieusement si le
découpage ne recouvre pas exactement les lignes du source. Un plugin n'a donc
rien à faire de particulier pour les constructions multi-lignes.

### 6.5 Services de l'hôte (plugin → hôte)

| Méthode | Capacité | Contrat |
| --- | --- | --- |
| `host/readFile` | `read:siblings` | `params: { rel }` → `result: { text }`. Chemin **relatif** au `dir` du document en cours de traitement, confinement de `read_data_file` + allowlist `siblingExtensions`. `error.code = "denied"` (hors confinement/allowlist) ou `"not-found"`. N'est valide que pendant le traitement d'une requête de l'hôte. |
| `host/log` | — (toujours) | Notification `{ level: "debug"|"info"|"warn"|"error", message }`. Journal visible dans le dialog d'info runtimes. |

### 6.6 Notifications hôte → plugin

| Méthode | Contrat |
| --- | --- |
| `theme/changed` | `{ theme: "light" | "dark" }` — thème effectif après bascule (`theme.js`). Les documents/fences déjà rendus sont de toute façon re-rendus par l'hôte ; cette notification sert aux caches internes du plugin. |

### 6.7 Classes de style fournies par l'hôte

Un plugin ne fournit pas de CSS : son markdown est rendu sous la feuille de
style de l'hôte. Pour les composants qu'un plugin de document émet en HTML
inline, l'hôte expose un petit vocabulaire de classes, stylé dans les deux
thèmes (`ui/css/app.css`) :

| Classe | Élément | Rendu |
| --- | --- | --- |
| `kd-fold` | `<details>` | Bloc dépliable encadré, `<summary>` en bandeau cliquable ; imbriqué, il est légèrement en retrait. |
| `kd-note` | `<div>` | Encart de documentation en retrait, liseré gauche, texte atténué. |

Ces classes survivent à DOMPurify (attribut `class` conservé). Toute autre
classe est permise mais reste sans style.

## 7. Exécution, erreurs, performances

### 7.1 Timeouts

`initialize` : 10 s. `document/transform`, `fence/render` : 30 s.
`highlight/render` : 5 s. Au-delà : `timeout`, worker tué, rendu dégradé
(§ 7.3). Le worker est redémarré paresseusement à la prochaine sollicitation
(3 échecs consécutifs ⇒ plugin marqué « en panne » jusqu'au redémarrage de
l'app ou à sa réinstallation).

### 7.2 État

Le protocole est **sans état** entre requêtes : chaque `document/transform`
reçoit le texte intégral. Un plugin peut maintenir des caches internes
(grammaire compilée, module WASM instancié) mais doit survivre à un worker
frais à tout moment.

### 7.3 Dégradation côté hôte

Si un plugin requis est en panne, inerte ou absent (fichier `.csv` ouvert sans
plugin `csv-tables`) : l'hôte affiche le document en **source brut dans une
fence** sous un bandeau explicatif — le fichier reste lisible, jamais d'onglet
vide. Une fence sans handler suit le rendu markdown par défaut (bloc de code),
comportement actuel inchangé.

## 8. Résolution des conflits

1. **Natif d'abord** : une extension de `DOC_EXTENSIONS` (`manager.rs`) ou une
   fence native (`KROKI_TYPES`/`KROKI_ALIASES`/`plotly`, `render.js`) ne peut
   pas être revendiquée. La revendication est ignorée ; avertissement dans la
   liste des plugins. Si un natif est un jour retiré (ex. migration Plotly),
   les plugins installés qui le revendiquaient prennent le relais au
   redémarrage suivant, sans changement de protocole.
2. **Entre plugins** : dernier installé gagne (extension comme fence),
   avertissement listant le perdant. Désinstaller le gagnant rend la main au
   précédent. Cette règle s'applique **par type de revendication** (extension,
   fence, coloration) — deux revendications de types différents sur le même
   nom ne sont pas un conflit d'enregistrement.
3. **Fence > coloration** (précédence inter-types, découle du pipeline) : si un
   plugin revendique la *fence* d'un langage et un autre (ou le même) sa
   *coloration*, tout bloc ` ```<langage> ` devient un diagramme rendu par le
   fence handler — il n'est jamais émis comme bloc de code, donc la coloration
   n'est **jamais consultée** pour ce langage. La coloration ne s'applique
   qu'aux blocs rendus en code, c'est-à-dire : (a) quand aucun fence handler
   n'est installé pour ce langage — elle joue alors de fallback naturel après
   désinstallation du fence handler — ou (b) pour les langages que personne ne
   rend en diagramme. Nuance : une **erreur** du fence handler affiche le bloc
   d'erreur standard, elle ne retombe PAS sur la coloration (un rendu raté
   n'est pas un bloc de code). Corollaire : un plugin qui revendique fence
   **et** coloration du même nom rend sa propre coloration inerte dans les
   previews — elle ne reste utile que comme fallback si sa capacité fence
   cesse d'être servie.

## 9. Installation, mise à jour, découverte

### 9.1 Emplacement

- Windows : `%APPDATA%\kroki-deskapp\plugins\<id>\` — chemin **délibérément
  hors** du dossier d'identité Tauri, qui suit l'`identifier` du bundle : le
  chemin des plugins (et de `settings.json`, posé à côté) n'en dépend pas.
- Linux : `$XDG_CONFIG_HOME/kroki-deskapp/plugins/<id>/` (défaut
  `~/.config/…`).

Contenu : l'archive décompressée + `manifest.json` à la racine. La version
précédente est conservée en `<id>.bak/` (rollback manuel possible).

### 9.2 Installation à l'initiative de l'utilisateur

Une archive `.kdext` désignée par l'utilisateur — déposée sur une fenêtre,
passée en argument de ligne de commande, ou ouverte par double-clic quand
l'installeur a associé l'extension — converge vers le même flux : le tri est
fait une fois pour toutes par `manager::open_mixed_paths`, qui route les
`.kdext` vers l'installation au lieu de les ouvrir en onglet. Ce flux
déclenche :

1. lecture du manifeste **sans exécuter le plugin** ; rejet propre si
   `manifestVersion`/`apiVersion` insupportés ou archive invalide ;
2. **dialog de confiance** — obligatoire, y compris en mise à jour : nom,
   éditeur, version (`ancienne → nouvelle` le cas échéant), extensions et
   fences revendiquées, capacités demandées en clair (« peut lire les
   fichiers `.json` du dossier des documents ouverts ») et l'avertissement de
   principe : *un plugin exécute du code (sandboxé) fourni par un tiers* ;
3. extraction vers le dossier § 9.1 (l'existant devient `.bak`) ;
4. rechargement à chaud du registre : worker de l'ancienne version tué, les
   onglets ouverts des types concernés sont re-rendus.

Un `version` inférieur à l'installé est un **downgrade** : autorisé, mais
signalé comme tel dans le dialog.

Une seule voie d'installation se dispense du dialog de confiance, et elle est
décrite au § 9.5 : les plugins livrés avec l'application elle-même.

### 9.3 Découverte au boot & intégration backend

Au démarrage, le **backend Rust** énumère `plugins/*/manifest.json` (parsing
serde, aucune exécution de JS) et en dérive la liste dynamique des extensions
de documents : filtres du dialog d'ouverture (`commands.rs`), acceptation du
drag & drop (`drop_target.rs`/`filedrop.js`), arguments de ligne de commande et
forward `single-instance`. `DOC_EXTENSIONS` reste la liste *native* ; la liste
effective = natives ∪ plugins actifs. La synchronisation manuelle
`manager.rs`/`filedrop.js` imposée aujourd'hui à chaque nouveau format disparaît
pour les formats plugin.

Le frontend reçoit le registre (commande `list_plugins`) et route
`showView`/`hydrateDiagrams` en conséquence. La consultation et la gestion
passent par le dialog dédié du § 9.4.

### 9.4 Interface de gestion des plugins

Dialog « Plugins » dédié, accessible depuis la toolbar (au même rang que les
dialogs Réglages / Infos / Nouveautés existants). Contenu :

- **Liste des plugins installés**, une carte par plugin, affichant au minimum :
  **nom**, **description**, **version** — complétés de l'éditeur
  (`publisher`), de l'état (actif / inerte avec raison / en panne § 7.1 /
  conflit § 8 avec l'avertissement en clair) et des revendications servies
  (extensions, fences, highlights). Liste vide → message expliquant les deux
  voies d'ajout.
- **Bouton « Nouveautés »** sur chaque carte dont le plugin embarque un
  `CHANGELOG.md` (§ 3.1) : ouvre le dialog changelog de l'hôte sur le journal
  du plugin, rendu sanitizé, sans exécuter le plugin.
- **Bouton « Supprimer »** sur chaque carte : confirmation explicite, puis
  suppression du dossier `plugins/<id>/` (y compris le `.bak`), arrêt du
  worker, re-rendu des onglets ouverts concernés (qui retombent sur le rendu
  dégradé § 7.3 — ou sur le plugin perdant d'un conflit § 8, qui reprend la
  main). Pas de corbeille : l'utilisateur ré-installe depuis son `.kdext` s'il
  se trompe.
- **Bouton « Ajouter un plugin… »** en bas du dialog, pleine largeur : ouvre
  un sélecteur de fichier natif filtré `.kdext` puis déroule **exactement le
  circuit du § 9.2** (validation du manifeste, dialog de confiance,
  extraction, rechargement à chaud). Le glisser-déposer d'un `.kdext` sur la
  fenêtre principale (§ 9.2) reste fonctionnel en parallèle — les deux voies
  convergent vers le même flux après l'obtention du chemin de l'archive.

Volontairement hors v1 : activer/désactiver sans désinstaller, mise à jour
automatique depuis une source distante, tri/recherche. Le journal `host/log`
reste consultable dans le dialog d'info runtimes (`info.js`), pas ici — la
gestion et le diagnostic sont deux usages distincts. Seuls les plugins livrés
avec l'application se mettent à jour seuls, et uniquement quand l'application
elle-même est mise à jour (§ 9.5).

### 9.5 Plugins livrés avec l'application

Les installeurs embarquent les archives `.kdext` des plugins retenus par la
stratégie d'embarquement du dépôt (`bundled-plugins.default.txt`, cf. README) ;
celui de Windows laisse l'utilisateur cocher ceux à installer ; celles qu'il retient
sont déposées dans `<resource_dir>/bundled-plugins/`, le dossier de
l'exécutable. Au démarrage, **avant** la découverte du § 9.3, l'hôte les
installe et les met à jour **sans dialog de confiance**
(`plugins::seed_bundled`).

L'hôte ne connaît pas cette sélection et n'a pas à la connaître : il installe ce
qu'il trouve dans le dossier. Un plugin décoché est simplement absent — ce qui
rend le mécanisme identique pour un build portable (dossier absent = no-op) et
pour une installation partielle.

C'est la seule dérogation au § 9.2, et elle tient à un seul argument : ces
archives proviennent du **même installeur que l'exécutable**. Demander à
l'utilisateur d'accorder sa confiance à un plugin qu'il vient d'installer en
même temps que l'application n'ajouterait aucune information — il a déjà
accordé cette confiance au binaire qui l'affiche. Toute archive venue d'ailleurs
(mail, partage, téléchargement) passe par le § 9.2 sans exception.

Trois règles bornent le mécanisme :

1. **pas de régression** — un plugin installé en version supérieure ou égale à
   celle livrée est laissé intact ; une version posée à la main reste en place ;
2. **la suppression est définitive** — un plugin retiré depuis le dialog du
   § 9.4 est mémorisé dans `settings.json` (`removed_plugins`) et n'est plus
   réinstallé, sans quoi le bouton « Supprimer » serait annulé au démarrage
   suivant ;
3. **réinstaller le remet dans le circuit** — installer le plugin à la main
   (§ 9.2) efface cette mémoire : il redevient éligible aux mises à jour.

Le dossier des plugins étant per-utilisateur (§ 9.1) alors que l'installeur est
per-machine, l'installation ne peut pas être faite par l'installeur lui-même :
elle a lieu au premier lancement qui suit, pour chaque session utilisateur.

Les builds portables (exécutable seul) n'embarquent aucune archive : le dossier
est absent, l'étape est un no-op et le comportement est celui d'avant.

## 10. Réservations (nommées en v1, non implémentées)

Ces éléments existent dans le protocole **uniquement** pour que leur ajout
futur ne casse aucun plugin ni aucun hôte v1.

### 10.1 `document:webview`, `fence:webview`, `document:html`

Vue fournie par le plugin dans une **iframe sandboxée** (`sandbox="allow-scripts"`,
sans `allow-same-origin`), servie par un protocole custom Tauri, communication
`postMessage` uniquement. L'hôte poussera : source, thème (tokens CSS),
notifications du watcher ; le plugin remontera : navigation (deep-links
`doc#fragment`), plan pour le sommaire, hauteur. À concevoir en détail au
moment de l'implémentation ; les identifiants de capacités et le champ
`runtime` suffisent à la compat. Un hôte v1 face à un plugin purement webview
le déclare inerte avec le message dédié (§ 3).

Coût assumé (décision de conception) : une vue webview n'hérite **pas** de
l'intégration markdown (sommaire, vue source remappée, recherche, impression) —
chaque point redevient un message optionnel du protocole. Première zone sur la
liberté, seconde zone sur l'intégration.

### 10.2 `runtime: "process"`

Plugin en **processus natif** (modèle LSP : JSON sur stdio, mêmes méthodes),
pour les runtimes impossibles en WASM (JVM…). Changement de nature assumé :
plus de sandbox (droits complets de l'utilisateur), binaires par plateforme,
signature/antivirus — le dialog de confiance devra le dire brutalement.
Non planifié : la voie officielle des langages compilés est WASM derrière un
worker (§ 2), qui couvre notamment tous les moteurs C/Go/Rust du projet
(graphviz, d2, svgbob, pikchr y passeraient sans nouveau protocole).

## 11. Feuille de route de référence

1. **Extraction à froid** (aucun plugin dynamique) : refactorer un format
   compilé dans le binaire derrière l'interface exacte de § 6 (registre
   interne `registerFileType`). Valide le contrat sur un format réel avant de
   le figer publiquement.
2. **Hôte v1** : worker + manifeste + install par drop + registre backend.
   Ce format devient le premier plugin externe — objectif d'origine : suivre
   les évolutions d'un format **sans recompiler l'application** (le frontend
   étant embarqué dans le binaire, tout changement `ui/` exige un
   `cargo build`).
3. **`fence:svg`/`fence:html`** si non inclus en 2.
4. **Webview / process** : uniquement sur besoin réel avéré, jamais « pour
   faire bien ».

## 12. Exemples complets minimaux

Un exemple par point d'extension. Convention commune : l'hôte fournit dans le
worker un global `kd` — `kd.onRequest(method, handler)` (le handler retourne le
`result`, lève pour produire un `error`), `kd.request(method, params)` (appel
d'un service de l'hôte, retourne une promesse) et `kd.notify(method, params)`.

### 12.1 `document:markdown` — les `.csv` en tables

`manifest.json` :

```json
{
  "manifestVersion": 1,
  "id": "csv-tables",
  "version": "1.0.0",
  "apiVersion": "1",
  "name": "CSV as tables",
  "description": "Affiche les .csv en tables markdown",
  "publisher": "acme",
  "runtime": "worker",
  "entry": "main.js",
  "extensions": [".csv"],
  "capabilities": ["document:markdown"]
}
```

`main.js` :

```js
kd.onRequest("initialize", () => ({ ok: true }));
kd.onRequest("document/transform", ({ text, title }) => {
  const rows = text.trim().split(/\r?\n/).map((l) => l.split(","));
  const md = [
    `# ${title}`,
    "",
    `| ${rows[0].join(" | ")} |`,
    `| ${rows[0].map(() => "---").join(" | ")} |`,
    // ancre par ligne de données : ligne markdown → ligne du .csv source
    ...rows.slice(1).map((r) => `| ${r.join(" | ")} |`),
  ];
  const anchors = [[0, 0], ...rows.slice(1).map((_, i) => [4 + i, 1 + i])];
  return { markdown: md.join("\n"), anchors };
});
```

Ouvrir `ventes.csv` affiche le document dérivé ; la vue source montre le CSV
brut ; le clic sommaire/preview retombe sur la bonne ligne du fichier via les
ancres.

### 12.2 `fence:svg` — un langage de fence `barchart`

Rend dans **n'importe quel document markdown** (ou dérivé d'un autre plugin) :

````markdown
```barchart max=120
CAL-26;98
Q3-26;61
M+1;24
```
````

ou, données externes (le service « image de fallback jumelle », § 6.3, joue
alors automatiquement) :

````markdown
![fallback](ventes.png)
```barchart src=ventes.csv max=120
```
````

`manifest.json` :

```json
{
  "manifestVersion": 1,
  "id": "barchart",
  "version": "1.0.0",
  "apiVersion": "1",
  "name": "Bar chart",
  "description": "Fences ```barchart : barres horizontales SVG",
  "publisher": "acme",
  "runtime": "worker",
  "entry": "main.js",
  "fences": ["barchart"],
  "capabilities": ["fence:svg", "read:siblings"],
  "siblingExtensions": [".csv"]
}
```

`main.js` :

```js
kd.onRequest("initialize", () => ({ ok: true }));
kd.onRequest("fence/render", async ({ source, options, theme }) => {
  // bloc vide + src= : données lues via l'hôte (confinement read:siblings)
  let text = source.trim();
  if (!text && options.src) text = (await kd.request("host/readFile", { rel: options.src })).text;
  const rows = text.trim().split(/\r?\n/).map((l) => l.split(";"));
  const max = Number(options.max) || Math.max(...rows.map(([, v]) => Number(v)));
  const fg = theme === "dark" ? "#e6e6e6" : "#1f1f1f";
  const bars = rows.map(([label, v], i) =>
    `<text x="0" y="${i * 24 + 15}" fill="${fg}" font-size="12">${esc(label)}</text>` +
    `<rect x="90" y="${i * 24 + 4}" width="${(300 * Number(v)) / max}" height="14" fill="#4c8dd6"/>`,
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="${rows.length * 24}">${bars.join("")}</svg>`;
  return { format: "svg", content: svg };
});
const esc = (s) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
```

Le `theme` reçu est le thème **effectif** de l'app (réglage auto/light/dark
déjà résolu) — un plugin ne consulte jamais `prefers-color-scheme` lui-même,
sinon il ignorerait le forçage du réglage.

### 12.3 `highlight:code` — coloration des fences ` ```ini `

`manifest.json` :

```json
{
  "manifestVersion": 1,
  "id": "ini-highlight",
  "version": "1.0.0",
  "apiVersion": "1",
  "name": "INI highlight",
  "description": "Coloration des fences ```ini",
  "publisher": "acme",
  "runtime": "worker",
  "entry": "main.js",
  "highlights": ["ini"],
  "capabilities": ["highlight:code"]
}
```

`main.js` :

```js
kd.onRequest("initialize", () => ({ ok: true }));
kd.onRequest("highlight/render", ({ code }) => {
  const html = code
    .split(/\r?\n/)
    .map((line) => {
      const e = esc(line);
      if (/^\s*[;#]/.test(line)) return `<span class="hljs-comment">${e}</span>`;
      if (/^\s*\[.*\]\s*$/.test(line)) return `<span class="hljs-section">${e}</span>`;
      const m = line.match(/^(\s*)([^=]+?)(\s*=\s*)(.*)$/);
      if (!m) return e;
      return `${m[1]}<span class="hljs-attr">${esc(m[2])}</span>${esc(m[3])}` +
             `<span class="hljs-string">${esc(m[4])}</span>`;
    })
    .join("\n");
  return { html };
});
const esc = (s) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
```

Deux règles illustrées ici : le plugin **échappe lui-même** le code (sa sortie
est du HTML ; l'hôte sanitize ensuite en n'autorisant que `<span class="hljs-…">`,
toute autre balise ou attribut est retiré) et n'émet que des classes `hljs-*`
existantes — les couleurs viennent du thème hljs de l'hôte, un plugin n'apporte
pas de CSS. Rappel projet : choisir les scopes par **concept métier** du
langage coloré, pas par famille technique hljs.
