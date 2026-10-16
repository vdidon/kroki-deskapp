# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Vue d'ensemble

Kroki Desk est une visionneuse Markdown native Windows (Tauri 2 / Rust backend +
frontend statique) qui rend les blocs de diagrammes Kroki (`mermaid`, `plantuml`,
`graphviz`, `d2`, `bpmn`, `svgbob`…) en SVG **sans serveur, sans Docker, sans
réseau** : tous les moteurs sont embarqués dans l'exécutable. Le binaire final est
un fichier unique autonome.

Le `README.md` documente en détail les fonctionnalités utilisateur, la liste des
moteurs et les notes de sécurité — le lire avant de toucher au rendu ou à la CSP.

## Commandes

Des alias Cargo (`.cargo/config.toml`) pilotent le crate `src-tauri/` **depuis la
racine du dépôt**, sans `cd src-tauri` :

```bash
# Build release (binaire autonome → dist/kroki_deskapp-<version>.exe
#                 + twin non versionné dist/kroki_deskapp.exe)
cargo build-app

# Build/run debug (lance l'app)
cargo run-app

# Lint / format Rust
cargo lint-app && cargo fmt-app

# AppImage Linux (sur machine/conteneur Linux uniquement ; requiert tauri-cli)
cargo build-appimage

# Installeur MSI Windows (Windows uniquement ; requiert les .kdext dans dist/)
cargo build-msi

# Paquet Debian/Ubuntu (Linux uniquement ; requiert les .kdext dans dist/)
cargo build-deb
```

Les alias transmettent les arguments (`cargo run-app -- --flag`) et ciblent le crate
via `--manifest-path` : `src-tauri` reste un package standalone (profils release et
dossier `target/` inchangés). Équivalent brut si besoin : ajouter `--manifest-path
src-tauri/Cargo.toml` à la commande cargo, ou l'ancienne forme `cd src-tauri && cargo …`.

`build-app`, `build-appimage`, `build-msi` et `build-deb` passent par le crate
`xtask/` qui,
après le build, **publie l'artefact dans `dist/`** (gitignoré) : nom postfixé de la
version (`kroki_deskapp-<version>.exe`, `kroki_deskapp-<version>.msi`,
`kroki_deskapp-<version>-linux-<arch>-<distro>`,
`…-linux-<arch>-<distro>.AppImage`, `…-linux-<arch>-<distro>.deb`
— `<distro>` = tag de la distro qui compile,
lu dans `/etc/os-release` : `debian12` pour le conteneur, `ubuntu24.04`… ; un
build natif et un build Docker ne s'écrasent donc jamais dans `dist/`) doublé
d'un fichier non versionné pointant sur le
même contenu — hardlink de préférence (fonctionne sans droit administrateur,
NTFS comme ext4 ; un symlink Windows exigerait admin/mode développeur), copie
en repli (FS sans hardlink, ex. montages Docker Desktop). Cf. `publish_dist`
dans `xtask/src/main.rs`. Le brut `cargo build --release --manifest-path
src-tauri/Cargo.toml` reste possible mais ne publie rien dans `dist/`.

Il n'y a **pas de bundler frontend** : `tauri.conf.json` pointe `frontendDist` sur
`../ui` (HTML/JS/CSS statiques, `withGlobalTauri: true`, vendors pré-buildés dans
`ui/vendor/` et `ui/renderer/vendor/`). Aucune étape `npm install`/`npm build`.
`bundle.active: false` → `cargo build` produit l'`.exe` nu ; les installeurs
passent tous par un overlay de config et `tauri build` (cf. ci-dessous).

### Installeur Windows (MSI)

`cargo build-msi` (Windows uniquement — WiX v3 n'y tourne que là) produit
`dist/kroki_deskapp-<version>.msi` + twin. Même patron que l'AppImage : le
xtask bootstrappe `tauri-cli` si besoin puis délègue à `tauri build --config
src-tauri/tauri.msi.conf.json` — c'est **l'overlay** qui active le bundling,
`tauri.conf.json` garde `bundle.active: false`. Le binaire portable reste le
livrable principal ; le MSI s'y ajoute, il ne le remplace pas.

Ce que l'overlay porte, et pourquoi :

- **La page de sélection des plugins et les associations de fichiers**, dans
  deux fragments : `src-tauri/wix/installer.wxs` (suivi : formats natifs, App
  Paths) et `src-tauri/wix/plugins.generated.wxs` (gitignoré, **généré à chaque
  build** par `xtask/src/bundled.rs` depuis la stratégie d'embarquement, cf.
  ci-dessous : propriétés `PLUGIN_*`, composants des archives et de leurs
  associations, page `PluginDlg`). Branchés par `wix.fragmentPaths` +
  `wix.componentGroupRefs` ; **les trois** ComponentGroup doivent être
  référencés, sinon les composants de l'un ne sont rattachés à aucune feature.
  Ni `bundle.fileAssociations` ni `bundle.resources` ne sont utilisés, pour la
  même raison : le bundler place ce qu'ils déclarent dans des composants
  **qu'il génère lui-même** — celui de l'exécutable pour les associations, un
  par fichier avec un Id aléatoire à chaque build pour les ressources — et WiX
  interdit d'ajouter une condition à un composant déclaré ailleurs. Or les
  archives doivent suivre les cases, et les associations d'un format servi par
  un plugin doivent suivre **le plugin**, pas l'application. Quatre choses à
  savoir avant d'y toucher :
  - **Les `.kdext` sont déclarés en `<File>`** (fragment généré), un composant conditionné par
    plugin sous `INSTALLDIR\bundled-plugins`. Les archives sont **toutes** dans
    le cab du MSI ; seules les cochées sont écrites sur disque. Le chemin source
    passe par `$(sys.SOURCEFILEDIR)` (dossier du .wxs) et non par un relatif au
    cwd, que Tauri n'expose pas. Côté Rust, **rien à faire** :
    `plugins::seed_bundled` installe ce qu'il trouve dans
    `resource_dir()/bundled-plugins/`. Corollaire : décocher un plugin
    **déjà installé** ne le désinstalle pas — le seeding ajoute et met à jour,
    il ne retire jamais.
  - **Les associations n'ont pas de page** : toutes sont posées, seul le
    *niveau* varie — et il est choisi pour ce qu'il fait, pas par prudence
    affichée. `Software\Classes\<.ext>\(Default)` ne mord que sur une extension
    **vierge** : dès qu'un `UserChoice` existe (HKCU, hash protégé depuis
    Windows 8), il est ignoré et l'application n'apparaît qu'en suggestion —
    vérifié sur `.md`, pourtant sans autre programme déclaré. Il n'apporte donc
    rien sur un format partagé, alors qu'il y coûte : il écrase le `(Default)`
    en place (`htmlfile`, `txtfilelegacy`) et MSI ne le restaure pas à la
    désinstallation. D'où `(Default)` + `OpenWithProgids` pour `.kdws .kdext`
    **et toutes les extensions des plugins** (c'est ce qui fait marcher le
    double-clic, la raison d'être de l'installeur ; installer un plugin est un
    choix explicite, partagé ou non — `.tex`, `.csv` compris — et un
    `UserChoice` existant l'emporte de toute façon), et `OpenWithProgids`
    **seul** pour les formats natifs partagés (`.md`, `.txt`, `.html`…).
  - **La sélection des plugins conditionne leurs associations.** Une extension
    n'a de sens que si le plugin qui la lit est là : chaque composant
    `Assoc<Plugin>` (ProgID `KrokiDesk.<Plugin>` + extensions lues dans le
    manifeste) porte la condition `PLUGIN_<ID> = "1"`, les composants des
    formats natifs sont inconditionnels. Leur GUID est dérivé de l'id du
    plugin (`stable_guid`) : pas d'auto-GUID sous HKMU. Une seule famille de propriétés à connaître, `PLUGIN_*`,
    toutes `Secure="yes"` — sans ça, l'UI tournant sous le compte utilisateur ne
    les transmettrait pas au serveur d'exécution élevé et tout serait installé
    quoi qu'on décoche. Étant publiques, elles pilotent aussi l'installation
    silencieuse (`msiexec /i … /qn PLUGIN_CSV_TABLES=1`).
  - **Le dialogue s'insère par surcharge.** Tauri impose `WixUI_InstallDir`,
    qui n'a pas de page de personnalisation ; `PluginDlg` se glisse entre
    `InstallDirDlg` et `VerifyReadyDlg` via des `Publish` `NewDialog` d'`Order`
    supérieur (5 — WixUI_InstallDir monte à
    4), en reprenant sa condition de validation du chemin. Même tour que le
    template Tauri, qui saute la licence en `Order="2"`. La page a une taille
    fixe : 6 plugins au plus, le xtask échoue au-delà.

  L'exe y est désigné par `[INSTALLDIR]kroki_deskapp.exe` et **non** par la
  référence de fichier `[#Path]`, pourtant plus robuste au renommage : Tauri
  injecte les `componentGroupRefs` dans sa feature `External` alors que l'exe
  appartient à `MainProgram`, et MSI refuse qu'une valeur de registre référence
  un fichier d'une autre feature — **ICE69, erreur de link**, pas un
  avertissement. Renommer le binaire impose donc d'éditer le fragment.
- **Clé *App Paths*** (composant `AppPath` du même fragment,
  inconditionnel) : rend l'exe lançable par son nom via ShellExecute
  (`start kroki_deskapp "doc.tex#eq:x"`, `Start-Process`, Win+R) sans toucher
  au PATH — c'est la voie documentée pour un agent qui ouvre un document à une
  référence. Bash et CreateProcess ne la lisent pas.
- **`wix.template` remplacé** (`src-tauri/wix/main.wxs`) : copie du template
  de tauri-bundler (tauri-cli 2.11.4) avec **un seul** écart, signalé en
  commentaire — le raccourci du menu Démarrer n'a plus
  `Icon="ProductIcon"`. Cet attribut fait pointer le `.lnk` sur
  `%WINDIR%\Installer\{ProductCode}\ProductIcon`, dossier supprimé à chaque
  mise à jour majeure (ProductCode neuf à chaque build) ; l'épingle de la barre
  des tâches, **copie figée** du `.lnk` que MSI ne réécrit jamais, perdait son
  icône. Sans attribut, l'icône est lue dans l'exe (chemin stable) — comme le
  raccourci Bureau du template, qui n'a jamais eu le défaut. Prix : le template
  ne suit plus tauri-cli (`TAURI_CLI_VERSION = "^2"`, non figé) — à
  re-synchroniser (diff contre l'upstream de la version installée) lors d'une
  montée qui touche `main.wxs`.
- **`wix.upgradeCode` figé** (`03A2A6F1-…`) : c'est exactement la valeur que
  Tauri dérive aujourd'hui (UUID v5 de `"Kroki Desk.exe.app.x64"`), recopiée
  pour qu'un futur changement de `productName` ne casse pas la chaîne de mise à
  jour — sans ce GUID, chaque version s'installerait *à côté* de la précédente.
  Ne jamais le modifier.
- **`bannerPath` / `dialogImagePath`** : `src-tauri/wix/banner.bmp` (493×58,
  bandeau des pages intérieures) et `dialog.bmp` (493×312, accueil/fin)
  remplacent le logo WixUI par défaut (CD rouge). Tailles imposées par WixUI ;
  générés depuis `icons/icon.png` par `uv run scripts/wix_images.py`, à
  relancer si l'icône change.
- **`webviewInstallMode: skip`** : WebView2 est préinstallé depuis Windows 10
  2004. Les autres modes téléchargent à l'installation (réseau filtré) ou
  ajoutent 127 à 180 Mo.
- **Stratégie d'embarquement des plugins** (`xtask/src/bundled.rs`) : un
  fichier texte à la racine, une ligne `<id> [on]` par plugin (`on` = coché
  dans le MSI / installé au premier lancement du `.deb`), dans l'ordre de la
  page. `bundled-plugins.txt` (gitignoré — la sélection du poste) fait foi
  s'il existe, sinon `bundled-plugins.default.txt` (suivi — le comportement
  par défaut). **Seule source de la liste** : le nom affiché et les
  extensions viennent du `manifest.json` lu **dans `dist/<id>.kdext`** — pas
  dans `plugins/<id>/`, qui peut être une jonction irrésoluble dans le
  conteneur du `.deb`. `bundled::stage` recopie les archives retenues vers
  `src-tauri/bundled-plugins/` (gitignoré, **vidé à chaque build**) — c'est de
  là que les `<File>` du fragment les lisent — et échoue avec un renvoi vers
  `python build_dist.py --plugins-only` si l'une manque ; `build_dist.py` (qui
  empaquette et bundle par défaut, cf. § « Builds Linux ») enchaîne les deux
  étapes seul. Le sous-dossier `bundled-plugins/` n'est pas cosmétique :
  `resource_dir()` étant le dossier de l'exe, un binaire portable lancé depuis
  `dist/` installerait sinon tous les `.kdext` voisins. Le `.deb` passe par la
  **même** stratégie (cf. § suivant). Pour relire ce qui sera généré sans
  bundler : `cargo run --manifest-path xtask/Cargo.toml -- bundled`.

Le MSI est **per-machine** (`Program Files`, UAC à l'installation) : Tauri ne
propose pas de MSI per-user sans remplacer entièrement `wix.template`.

Le premier build télécharge WiX 3 dans `%LOCALAPPDATA%\tauri`.

### Paquet Debian/Ubuntu (.deb)

`cargo build-deb` (Linux uniquement — le bundler y pose les permissions Unix et
assemble l'archive `ar`) produit `dist/kroki_deskapp-<version>-linux-<arch>-<distro>.deb`
+ twin. Même patron que l'AppImage et le MSI : le xtask bootstrappe `tauri-cli`
si besoin, recopie les `.kdext` par `bundled::stage`, génère
`src-tauri/tauri.deb.generated.json` (le suivi `tauri.deb.conf.json` complété
des plugins : la fusion des configs Tauri **remplace** les tableaux, un overlay
partiel effacerait les `fileAssociations` natives) puis délègue à
`tauri build --config` sur ce fichier. Le distribuable est celui
construit dans le conteneur (`bash /app/scripts/linux_deb_build.sh`, aucun outil
téléchargé donc aucun volume de cache) : c'est le tag distro du nom qui le dit.

C'est le pendant Linux du MSI, mais **les deux mécanismes n'ont presque rien en
commun** — l'essentiel de ce qui suit explique en quoi.

- **Pas de page de sélection des plugins, et il ne peut pas y en avoir.** Un
  `.deb` n'a pas d'interface : `debconf` ne s'affiche qu'en ligne de commande et
  est court-circuité par les installateurs graphiques. Le choix est donc rendu
  par la **destination** : le `bundle.resources` généré place les plugins
  `on` dans `bundled-plugins/` — que `plugins::seed_bundled` installe au premier
  lancement, exactement comme sous Windows — et les autres dans
  `example-plugins/`, **que rien ne lit**. Tout est donc embarqué comme dans le
  cab du MSI, les mêmes sont installés par défaut, et les autres
  s'installent depuis le dialog Plugins (« Ajouter un plugin… », pointer
  `/usr/lib/Kroki Desk/example-plugins/`). Aucun code Rust n'a bougé :
  `resource_dir()` vaut `/usr/lib/<productName>` sur Linux, et c'est
  précisément là que le bundler dépose les ressources.
- **Les associations tiennent en deux fichiers, pas un.** `MimeType=` dans le
  `.desktop` ne fait que déclarer les types que l'application sait ouvrir ; il
  ne dit **nulle part** qu'un `.kdws` est de ce type. D'où
  `src-tauri/linux/kroki-desk.xml`, paquet *shared-mime-info* posé dans
  `/usr/share/mime/packages/` (`deb.files`), qui définit
  `application/x-kroki-desk-{session,plugin}` avec leurs `<glob>`. Le xtask en
  dérive `kroki-desk.generated.xml` (gitignoré, c'est lui qui est installé) en
  y ajoutant un type `text/x-kroki-desk-<ext>` (`<sub-class-of>` `text/plain`)
  pour chaque extension d'un plugin installé **sans type standard** ; celles
  qui en ont un (`STANDARD_MIME` : `.tex` → `text/x-tex`, `.csv` →
  `text/csv`…) gardent le leur — une extension standard oubliée de la table
  recevrait un type propre qui supplanterait le sien. Chacun est `<sub-class-of>` de sa forme réelle (zip, json,
  texte) : c'est ce qui garde les gestionnaires génériques disponibles, et
  surtout ce qui fait **gagner le glob contre la détection par contenu** — un
  `.kdext` est un zip, sans cette filiation le sniffing le classerait en
  `application/zip`.
- **Rien n'est imposé comme application par défaut, et il n'y a rien à
  imposer.** Là où Windows distinguait `(Default)` et `OpenWithProgids`, Linux
  n'a que `MimeType=` (= « sait ouvrir ») ; le défaut se joue dans le
  `mimeapps.list` de l'utilisateur, qu'un paquet n'a pas à écrire. Comme les
  types propres à l'application et à ses plugins n'ont **qu'un seul** gestionnaire
  déclaré, l'environnement de bureau les lui attribue de lui-même : le
  double-clic marche sans rien réclamer. Même résultat que le MSI, sans le
  compromis.
- **Un modèle `.desktop` est obligatoire, pour un seul caractère.** Celui du
  bundler écrit `Exec={{exec}}` **sans indicateur d'argument** : le lanceur n'a
  aucun endroit où passer le fichier, et un double-clic ouvrirait l'application
  vide. `src-tauri/linux/kroki-desk.desktop` reprend le modèle upstream et
  ajoute `%F`. C'est ça qui rend toutes les associations opérantes.
- **`text/plain` est volontairement absent** de `fileAssociations` — donc
  `.txt` n'est pas associé, seul écart au MSI. Linux n'a pas de granularité par
  extension : `.txt` *est* `text/plain`, et le déclarer ferait apparaître Kroki
  Desk dans le « Ouvrir avec » de tout fichier texte par héritage (`.py`,
  `.conf`, `.log`…) — que `expand_dropped_docs` **ignore silencieusement**, donc
  un clic sans effet. `text/x-tex` a le même défaut en plus petit (il couvre
  aussi `.sty`, `.cls`, `.ltx`) : accepté, parce que `.tex` est une
  fonctionnalité de tête.
- **Les scripts `postinst`/`postrm`** rafraîchissent la base MIME, l'index des
  applications et le cache d'icônes. Redondants avec les déclencheurs dpkg de
  `shared-mime-info` et `desktop-file-utils` — mais ces paquets ne sont que
  *recommandés*, d'où les gardes `command -v` et les `|| true` : un cache non
  régénéré ne doit pas laisser le paquet à demi configuré. Ils sont **exécutés
  par dpkg en root** : leurs fins de ligne doivent rester LF, ce que force
  `.gitattributes` (un `#!/bin/sh\r` fait échouer la configuration sans dire
  pourquoi).
- **`depends: ["libc6 (>= 2.36)"]`** est ajouté à la main. Tauri pousse déjà
  `libwebkit2gtk-4.1-0` et `libgtk-3-0` sans qu'on le demande (les deux
  s'installent sur Debian 12 et Ubuntu 24.04, où `libgtk-3-0t64` *provides*
  l'ancien nom), mais il n'appelle **pas** `dpkg-shlibdeps` : sans plancher
  glibc déclaré, le paquet s'installerait sur Ubuntu 22.04 pour y planter au
  lancement. `2.36` est la glibc de bookworm, donc du conteneur — un build
  natif sur une distro plus récente produit un paquet qui **sous-déclare** son
  plancher : c'est une raison de plus de ne distribuer que le `-debian12`.

Le paquet est **per-machine** (`/usr/bin`, `/usr/lib`) ; plugins, réglages et
sessions restent dans `~/.config/kroki-deskapp` et survivent à la
désinstallation — c'est aussi pourquoi le seeding des plugins a lieu au premier
lancement de chaque utilisateur, et pas à l'installation.

### Builds Linux

L'outillage Linux (Dockerfile, scripts de build et de test) vit dans
`scripts/`. `python build_dist.py` (racine du dépôt, cross-plateforme Windows/
Linux) génère **l'intégralité des artefacts de la version** en une commande
(daemon Docker démarré requis pour les étapes Linux). **Tout est produit par
défaut**, dans l'ordre du coût croissant — rien de lent ne doit pouvoir
retarder un artefact bon marché : les `.kdext` de tous les plugins de
`plugins/` (via `pack_plugin.py` — un dossier = un plugin dès qu'il porte un
`manifest.json`, jonctions vers d'autres dépôts comprises), le binaire natif de l'hôte
(`cargo build-app` — exe sur Windows, binaire Linux sur Linux), l'**installeur
MSI**, puis les étapes Docker : build de l'image `kroki-linux-build`, AppImage,
binaire Linux nu et **paquet `.deb`** → `dist/`, chacun versionné + twin non
versionné.

Chaque étape se retire par son `--skip-…` (`--skip-plugins`, `--skip-native`,
`--skip-msi`, `--skip-appimage`, `--skip-binary`, `--skip-deb`) ou s'isole par
son `--…-only` (`--native-only`, `--plugins-only`, `--msi-only`, `--deb-only`,
mutuellement exclusifs) ; s'y ajoutent `--skip-image-build`, `--compile-only`
(cargo build Linux de vérification seul, aucun artefact) et `--test` (test
runtime headless Xvfb via `scripts/linux_runtime_run.sh`, incompatible avec les
`--…-only`). Deux dépendances entre étapes : le MSI est **sauté d'office hors
Windows** (WiX v3 n'y tourne pas — erreur seulement si `--msi-only` l'exige),
et MSI comme `.deb` embarquent les `.kdext`, donc `--skip-plugins` les fait
réutiliser ceux déjà dans `dist/` (utile pour relancer un installeur sans
ré-empaqueter) au lieu de les retirer du bundle. Le `.deb` passe par Docker
même sur hôte Linux : le distribuable est celui de bookworm. Les
artefacts Linux étant suffixés du tag distro de build (cf. § « Commandes »),
natif et Docker coexistent dans `dist/` sur un hôte Linux ; le distribuable
est le `-debian12`. Le build Windows n'est possible que depuis Windows (pas
de cross-compilation ni de Docker Windows).

Trois formats livrables, sur machine Linux native ou via l'image Docker
`kroki-linux-build` (commandes `docker run` en en-tête de
`scripts/Dockerfile.linux`) :

- **Binaire semi-dynamique** — `cargo build --release` (ou `cargo build-app`).
  Crates liés statiquement (rustls, pas d'openssl), mais WebKitGTK/GTK3/glibc
  dynamiques : la machine cible doit avoir `libwebkit2gtk-4.1` installé.
- **AppImage autonome** — `cargo build-appimage` depuis la racine (un seul
  fichier portable, GTK/WebKitGTK embarqués → `target/release/bundle/appimage/`).
  L'alias lance le crate `xtask/`, qui utilise `tauri-cli` depuis le PATH s'il
  y est, sinon l'installe en one-shot dans `xtask/target/tools/` (local au
  dépôt, gitignoré) — seul cargo est requis — puis délègue à `tauri build
  --config src-tauri/tauri.appimage.conf.json` : c'est cet overlay qui active
  le bundling — `bundle.active` reste `false` dans `tauri.conf.json`, les
  builds Windows ne produisent donc toujours que l'`.exe`. Il faut par contre
  les paquets système du Dockerfile (dont `xdg-utils`), et le premier build
  télécharge linuxdeploy/appimagetool depuis GitHub. Après le bundling, le
  xtask publie l'AppImage dans `dist/` (versionnée + twin non versionné, cf.
  § « Commandes »). En Docker : `bash /app/scripts/linux_appimage_build.sh`
  enrobe l'alias (volume `/target`). Le xtask exporte aussi `NO_STRIP=1` (le strip
  embarqué dans linuxdeploy ne lit pas les sections RELR des distros récentes ;
  no-op de toute façon, libs déjà strippées) et **adoucit le hook GTK** du
  plugin en cache `~/.cache/tauri` : upstream force `GDK_BACKEND=x11`
  (tauri#8541), patché en « x11 seulement si `DISPLAY` existe » pour que
  l'AppImage se lance aussi en Wayland pur sans XWayland. L'AppImage
  **distribuable** se construit dans le conteneur (glibc bookworm =
  compatibilité large) : buildée sur une machine récente, elle embarque sa
  glibc/ses libs et ne tournera pas sur plus ancien.
- **Paquet `.deb`** — `cargo build-deb`, cf. § « Paquet Debian/Ubuntu (.deb) ».
  Même binaire semi-dynamique que le premier mode, mais installé
  (`/usr/bin` + `/usr/lib`), avec les associations de fichiers, les plugins
  livrés et une désinstallation propre. `sudo apt install ./<paquet>.deb` —
  **pas** `dpkg -i`, qui ne résout aucune dépendance.

### Tests (pilotage des webviews, nécessite l'app lancée)

Les tests sont des scripts Node ESM qui pilotent l'application **en cours
d'exécution** — il n'y a pas de `cargo test` couvrant l'UI.

```bash
# 1. Lancer l'app avec le port de debug CDP activé (PowerShell) :
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
cd src-tauri ; cargo run

# 2a. Harnais CDP (drag d'onglets, détachement, screenshots) :
node tests/cdp.mjs <port> <action> [filtre-titre-page]
#   actions : report | where | focus | reorder | tear-cancel | invoke-detach-at x y | shot

# 2b. Test des moteurs via l'API Kroki locale (POST sur 127.0.0.1:8442) :
node tests/test_nouveaux_moteurs.mjs
#   KROKI_URL=http://127.0.0.1:<port> pour cibler un autre port

# 2c. Test de la recherche multi-documents (autonome : crée/ouvre/referme
#     ses propres fixtures via les commandes Tauri) :
node tests/test_recherche_globale.mjs <port>

# 2d. Test de la recherche dans le document (Ctrl+F) et des options
#     Aa / ab / .* des deux recherches — même principe, autonome :
node tests/test_recherche_document.mjs <port>

# 2e. Test du voile de chargement (autonome) : présence sur un rendu lourd,
#     absence sur un rendu rapide, et animation qui survit au blocage du
#     thread principal (échantillonnage par screencast CDP) :
node tests/test_loading.mjs <port>
```

Deux suites tournent en revanche **sans application ni npm** (modules purs
confrontés aux vendors du dépôt) — les lancer après tout changement du rendu
LaTeX ou de la vue source :

```bash
node tests/test_latex_plugin.mjs [fichier.tex …]   # plugin latex-doc + coloration
node tests/test_hlsplit.mjs      [fichier.md …]    # découpe des lignes colorées
```

Un plugin monté par jonction depuis un autre dépôt y porte ses propres
tests.

## Versionnage (à gérer proactivement)

Schéma **`x.y.z`**, source de vérité **unique** : le champ `version` de
`src-tauri/Cargo.toml`. Tout le reste en dérive via `env!("CARGO_PKG_VERSION")`
(titre de fenêtre, user-agent `kroki.rs`, `/v1/health` `server.rs`) et
`tauri.conf.json` n'a plus de champ `version` — **ne jamais** écrire le numéro
ailleurs qu'au seul endroit de `Cargo.toml`.

| Composante | À incrémenter quand le changement est… |
| --- | --- |
| **`z`** | une **correction de bug** |
| **`y`** | un **ajout de fonctionnalité** |
| **`x`** | une **refonte complète** du programme |

Incrémenter une composante remet à **zéro** celles de droite (`1.4.1` → `1.5.0`
pour une fonctionnalité ; → `2.0.0` pour une refonte).

**Procédure attendue de l'agent** — dès qu'une modification destinée à être
buildée change le comportement visible par l'utilisateur, il prend l'initiative,
dans le **même commit** que le changement :

1. déterminer la composante d'après la nature du changement (bug → `z`,
   fonctionnalité → `y`, refonte → `x`) ;
2. mettre à jour `version` dans `src-tauri/Cargo.toml` ;
3. ajouter une entrée datée du jour en tête de `CHANGELOG.md` (sections
   *Keep a Changelog* : « Corrigé », « Ajouté »… + la ligne de lien en bas) —
   ce fichier est **embarqué dans le binaire** via `include_str!` (commande
   `get_changelog`, dialog « Nouveautés », accessible depuis le dialog
   « Informations ») : il est donc toujours
   en phase avec la version buildée, sans effet avant rebuild ;
4. marquer le commit du correctif/feature avec l'emoji 🔖 (cf. historique
   `🐛🔖 fix… → 1.4.1`, `✨🔖 feat… → 1.4.0`).

Proposer le numéro retenu et **demander confirmation** si la catégorie est
ambiguë (p. ex. correctif vs. petite fonctionnalité) ; sinon procéder. **Pas de
bump** pour un travail sans effet sur le binaire livré : refactor interne,
documentation, ré-organisation, `chore` de build.

## Architecture du rendu (le point clé)

Le rendu d'un diagramme traverse **4 environnements d'exécution** selon le type.
Tout passe par la commande Tauri `render_diagram` (`commands.rs`), qui appelle
`engine::render_local` (`engine.rs`). Le dispatch :

- **Natif Rust** (`NATIVE_TYPES = svgbob, pikchr`) — rendu synchrone dans le
  processus via les crates `svgbob` / `pikchr`.
- **JVM** (`JAVA_TYPES = plantuml, c4plantuml, ditaa`) — jars embarqués via
  `include_bytes!` (`assets/plantuml-mit.jar`, `assets/ditaa-0.11.0-standalone.jar`),
  extraits sur disque puis exécutés en sous-process **uniquement si Java est
  détecté** (`java_available`). Sinon message explicite. ditaa a son propre
  pipeline (`render_ditaa`, args ditaa + `--svg`, pas le `-pipe` de PlantUML) :
  intercepté avant la garde `JAVA_TYPES` dans le dispatch.
- **TeX** (`TEX_TYPES = tikz`, 3.18.0) — **rien d'embarqué** : `render_tikz`
  compile avec la distribution du poste, **uniquement si `latex` et `dvisvgm`
  sont sur le PATH** (`tex_available`, sondé une fois). Document LaTeX complet
  (forme Kroki) ou `tikzpicture` nue, enrobée par `tikz_document`. Chaîne :
  `latex` → DVI avec le pilote PGF `pgfsys-dvisvgm.def` (passé en ligne de
  commande, donc valable pour tout document), puis `dvisvgm --no-fonts`, qui
  convertit le texte en tracés. Quatre pièges, tous traités :
  **(1)** dvisvgm n'a de contours que pour les polices **Type 1** — avec
  `\usepackage[T1]{fontenc}` seul (polices EC, bitmap), il écrit le SVG
  **sans le texte**, en simple avertissement ; d'où `lmodern` préchargé avant
  la classe s'il est installé, et `missing_glyph_fonts` qui transforme
  l'avertissement en erreur ;
  **(2)** ses `id` de glyphes (`g20-11`) sont les mêmes dans chaque SVG :
  insérées dans la même page, deux figures se voleraient leurs glyphes —
  `scope_svg_ids` les préfixe d'un hash du source ;
  **(3)** MiKTeX ouvre sa fenêtre d'installation de paquets en plein rendu —
  `--disable-installer` (option propre à MiKTeX, d'où `TexTools::miktex`) ;
  **(4)** un premier appel à un MiKTeX neuf reconstruit ses bases (~15 s) —
  délai de 60 s par étape, processus tué au-delà. Sécurité : dossier
  temporaire, `-no-shell-escape`, `openin_any=p` (TeX Live). Test réel
  (sauté sans TeX) : `cargo test --manifest-path src-tauri/Cargo.toml tikz_tests`.
- **JS/WASM** (`JS_TYPES` : mermaid, graphviz, d2, bpmn, excalidraw, vega/vegalite,
  dbml, erd, nomnoml, wavedrom, bytefield) — délégués à une **webview cachée** (label
  `RENDERER_LABEL = "renderer"`, voir `engine::ensure_renderer`). Le backend émet
  un événement `render-job` ; `ui/renderer/renderer.js` exécute le moteur JS et
  rappelle `render_job_done` ; `engine::complete_job` débloque l'attente. Cette
  webview est démarrée **au boot** (`setup` dans `main.rs`) pour amortir le
  chargement des moteurs.

Les **alias** de types (`dot`→graphviz, `c4`→c4plantuml, `vega-lite`→vegalite,
`puml`→plantuml…) sont résolus par `engine::resolve_alias`, **dupliqué côté
frontend** — garder les deux en phase quand on ajoute un alias.

`renderer.js` mappe chaque type sur une fonction dans l'objet `ENGINES`. Détails
non triviaux : **d2** est en import dynamique (~8 Mo) et ses appels sont
**sérialisés** (un seul échange compile/render à la fois sur son worker) ; **dbml**
et **erd** (parseur maison `ui/renderer/erd.js`) génèrent du DOT rendu ensuite par le
graphviz WASM déjà chargé ; **bpmn** rend dans un conteneur hors écran ; **vega**
utilise l'`expressionInterpreter` (pas d'`eval`) ; **excalidraw** est en import
dynamique (~8 Mo) et rend via `exportToSvg` — ses polices manuscrites (14 Mo) ne sont
**pas** embarquées : les `@font-face` vides sont retirés et les familles réécrites en
police système (`fixExcalidrawFonts`).

### Serveur externe optionnel

Si un serveur Kroki externe est configuré dans les réglages, `kroki::render`
(`kroki.rs`) prend le relais via HTTP `reqwest` et couvre **tous** les types. Le
cache (`KrokiState.cache`) ne stocke que les succès, clé = hash(mode, type,
source, options) ; un re-render retente donc naturellement les erreurs.

## Modules backend (`src-tauri/src/`)

- `main.rs` — bootstrap Tauri : enregistre `single-instance` **en premier**
  (forward des args d'une 2ᵉ invocation), tous les `State`, les commandes, et le
  `setup` qui démarre watcher + webview de rendu + serveur HTTP + 1ʳᵉ fenêtre.
- `commands.rs` — toutes les commandes `#[tauri::command]` (frontière front↔back).
- `engine.rs` — dispatch du rendu intégré (cf. ci-dessus).
- `manager.rs` — fenêtres, onglets, détachement/rattachement par drag
  (`WindowFromPoint` Win32 au relâchement de la souris).
- `drop_target.rs` (Windows) — `IDropTarget` Win32 custom installé sur chaque
  fenêtre. wry n'extrait que `CF_HDROP` (Explorateur) ; on révoque son target et
  on enregistre le nôtre pour aussi accepter les chemins en `CF_UNICODETEXT` /
  `text/uri-list` (drags depuis Cursor/VS Code). L'ouverture est faite côté Rust ;
  l'overlay est piloté par l'événement `drop-overlay` (cf. `filedrop.js`).
- `plugins.rs` — registre des plugins (cf. « Système de plugins » ci-dessous) :
  scan des manifestes, install/désinstall des `.kdext` (zip), protocole custom
  `plugin://` servant les fichiers aux workers, `plugin_read_sibling` confiné.
- `session.rs` — sessions `.kdws` (JSON : fenêtres → fichiers ordonnés + onglet
  actif) : parse/résolution (chemins relatifs au dossier du `.kdws`, `/` à
  l'écriture), ouverture **toujours dans au moins une fenêtre neuve** (la
  fenêtre cible n'est reprise pour la fenêtre 1 que si elle n'a aucun onglet —
  démarrage sur un `.kdws`, fenêtre « déposer un fichier » ; sinon la session
  s'ouvre à côté sans se mélanger au travail en cours, les suivantes toujours
  neuves ; focus et `session-report` vont à la 1ʳᵉ fenêtre de la session ;
  entrées invalides signalées via l'event `session-report` → toast) et sauvegarde
  (commande `save_session`, chemins relativisés). Routage par
  `manager::open_mixed_paths`, entonnoir commun CLI / seconde instance / drops /
  dialogue d'ouverture. Pas de restauration automatique au démarrage.
- `server.rs` — API HTTP Kroki locale (`tiny_http`), 127.0.0.1 uniquement.
- `kroki.rs` — client serveur externe + cache.
- `watcher.rs` — rechargement auto sur changement disque (`notify`).
- `state.rs` — `AppState`, `SettingsState`, etc. (settings persistés dans
  `%APPDATA%\kroki-deskapp\settings.json`, à côté de `plugins\` et comme lui
  hors du dossier d'identité Tauri — `plugins::app_dir`).

## Frontend (`ui/`)

- `ui/js/` — fenêtre principale : `render.js` (markdown-it + fences Kroki, appelle
  `render_diagram`), `tabs.js`, `teardrag.js` (détachement d'onglets), `filedrop.js`,
  `settings.js` (réglages + accès au dialog Plugins), `theme.js` (override
  auto/light/dark), `info.js` (dialog « Informations » : version, runtimes,
  accès Nouveautés), `changelog.js` (dialog « Nouveautés », markdown-it dédié
  sans fence Kroki + DOMPurify), `export.js` (export du rendu de l'onglet
  actif en HTML autonome : CSS inlinées, images locales en data-URI via la
  commande `export_html`), `findword.js` (surlignage des occurrences du mot
  sélectionné),
  `globalsearch.js` (panneau de recherche dans tous les onglets, `Ctrl+Maj+F` :
  cherche dans le source relu via `read_document`, saute vers la ligne par
  `scrollToLine` et surligne via la Custom Highlight API `search-occurrences`),
  `docsearch.js` (barre de recherche dans le document affiché, `Ctrl+F`, cf.
  ci-dessous), `searchopts.js` (options `Aa`/`ab`/`.*` → RegExp, cf. ci-dessous),
  `textmatch.js` (occurrences → `Range`, partagé par les trois recherches),
  `icons.js` (registre des icônes de barre d'outils, cf. ci-dessous),
  `loading.js` (voile de chargement, cf. ci-dessous),
  `main.js`, `app.js` (helpers + ré-export `invoke`).
- **Deux zooms** (3.17.0) : le zoom texte (`Ctrl+molette`, `setZoom`) et le
  zoom de page (`Maj+molette`, `setPageZoom`) se composent dans un **seul**
  `zoom` CSS sur `#views` (`applyZoom`, `main.js`). Le `zoom` CSS seul n'est
  qu'un zoom texte : la colonne logique rétrécit d'autant que l'échelle
  grandit, donc une figure en `max-width: 100%` garde sa taille à l'écran. Le
  zoom de page maintient les enfants de `.doc-view` à la largeur qu'ils
  auraient à l'échelle 1 (`--page-w` dans `app.css`, calculée depuis
  `--page-zoom` et le padding horizontal `--pad-x`) : mise en page identique
  à toute échelle, aucun reflux, débordement horizontal. C'est ce qui rend le
  zoom autour du curseur exact : les coordonnées logiques d'un point de contenu
  sont invariantes, seul le défilement est reposé. Tout code qui mesure des
  rects contre `scrollTop`/`scrollLeft` doit diviser par l'échelle **totale**
  (`box.height / clientHeight`, cf. `revealCurrent` dans `docsearch.js`), et
  toute règle qui dimensionne un enfant direct de `.doc-view` doit passer par
  `--page-w`, pas par `100%`.
- **Voile de chargement** (3.14.0) : `ui/js/loading.js` couvre l'attente d'un
  rendu long (~1,4 s pour un `.tex` de 100 Ko). Trois contraintes, toutes
  contre-intuitives et toutes vérifiées par `tests/test_loading.mjs` :
  **(1)** la phase lourde (markdown-it + KaTeX + DOMPurify + insertion DOM) est
  **synchrone** — un `setTimeout` ne peut donc pas s'y déclencher, et le délai
  anti-flash de 180 ms ne couvre que les phases *asynchrones* (transformation
  par un plugin). D'où `beforeHeavyRender`, qui décide sur la **taille** du
  markdown (seuil 60 000 caractères) et pose le voile d'avance ;
  **(2)** poser le voile ne suffit pas à l'afficher : sans rendre la main au
  navigateur (double `requestAnimationFrame`), il ne serait peint qu'une fois
  le rendu terminé ; **(3)** son animation doit porter **uniquement** sur
  `transform`/`opacity`, seules propriétés que Chromium anime sur le
  compositeur — toute autre se figerait pendant le blocage, exactement quand
  le voile doit rassurer. Seule la preview le déclenche (`isPreview`) : les
  vues source et dérivée ne font que colorer du texte (~100 ms) et
  clignoteraient. L'overlay vit dans `#content`, hors de la vue, en
  `pointer-events: none` — le contenu précédent reste visible et défilable
  pendant un rechargement sur modification disque.
- **Icônes des barres d'outils** (3.12.0) : `ui/js/icons.js` est le **registre**
  des icônes désactivables (id du bouton, libellé, défaut). Deux groupes : la
  barre de fenêtre (`#tabbar-actions`, masquée directement par `applyIcons`) et
  la pile d'actions de vue (`#view-actions`, dont `updateViewActions` dans
  `main.js` croise `iconEnabled(id)` avec la pertinence pour le document). Le
  réglage persiste dans `settings.json` (`SettingsData::icons`) sous forme
  **partielle** : seules les cases explicitement cochées/décochées y figurent,
  toute icône absente suit son `def` — un défaut modifié plus tard s'applique
  donc aux postes qui n'y ont jamais touché. Le dialog est construit par
  `settings.js` en clonant le `<svg>` du bouton réel (une icône ajoutée à
  `index.html` n'a qu'à être déclarée dans le registre). Réglage global :
  propagé aux autres fenêtres par l'event `icons-changed` (même protocole
  `from` que `theme-changed`), lu au boot par la commande `get_icons`. Deux
  garde-fous : l'engrenage Réglages est `locked` (jamais masquable — seul accès
  au dialog), et `enforceIconAvailability` (`main.js`) ramène les vues à un état
  atteignable quand on désactive « Code source », « Markdown intermédiaire » ou
  « Pleine largeur ».
- **Les trois recherches** (3.13.0) : le surlignage du mot sélectionné
  (`findword.js`), la recherche dans le document (`docsearch.js`, `Ctrl+F`) et
  la recherche multi-documents (`globalsearch.js`, `Ctrl+Maj+F`) partagent
  `searchopts.js` — `buildMatcher` compile la requête et les options
  (casse / mot entier / regex) en **une RegExp globale**, seule forme de motif
  circulant ensuite (`collectMatchRanges`, `findHits`). Deux pièges y sont
  traités une fois pour toutes : `\b` est ASCII-only (il couperait `été` en
  deux) — d'où des lookarounds sur un `\w` étendu ; et une regex peut matcher
  du vide (`a*`) — d'où `iterMatches`, qui saute ces correspondances au lieu de
  boucler sur `lastIndex`. Un motif invalide **lève** : chaque appelant en fait
  un état affiché (champ rouge), jamais une exception qui remonte.
  `docsearch.js` cherche dans le **DOM rendu** de la vue active (pas le source) :
  il suit donc le mode d'affichage, et tout ce qui remplace ce DOM
  (`showActive`, `toggleSource`, `toggleDerived`) doit appeler
  `refreshDocSearch()` — les `Range` mémorisés pointent sinon des nœuds
  détachés. Depuis la 3.22.0, l'occurrence courante est mémorisée **par
  document** (`positions`, clé = vue, valable pour la même requête/options),
  et `collectMatchRanges` (`textmatch.js`, donc les trois recherches) **ignore
  le contenu replié** — corps de `<details>` fermé, éléments `hidden` ; test
  structurel, pas `checkVisibility()` qui rejetterait les `display: contents`.
  Un `toggle` de `<details>` dans la vue relance Ctrl+F sur la même occurrence
  (`anchor`). `#find-ruler` (hors de `#views`, donc hors zoom) porte un trait
  par occurrence sur la barre de défilement, redessiné via un
  `ResizeObserver` sur la vue **et ses enfants directs** (la boîte de la vue ne
  change pas quand son contenu grandit). `Ctrl+F`, `F3` et `Ctrl+G` sont **interceptés** (`preventDefault`
  dans `initShortcuts`) pour neutraliser la barre de recherche native de la
  webview. Sommaire, `#find-bar` et `#search-panel` partagent la même ancre à
  l'écran : ils sont exclusifs (hooks `beforeOpen`).
- **Coloration de la vue « code source »** (3.11.0) : `sourcehl.js` peint la vue
  produite par `renderSource` **après coup**, sans toucher au nombre de lignes
  ni aux hauteurs — l'alignement preview ↔ source (`data-line`) et le
  `scrollToLine` déjà fait par l'appelant restent donc valides, même quand la
  coloration arrive d'un plugin (asynchrone). `sourceHighlightFor` (`plugins.js`)
  choisit la grammaire : hljs de l'hôte pour le markdown, sinon la grammaire du
  plugin qui sert l'extension, cherchée par convention `<ext>-source` puis
  `<ext>` (`tex-source` ; cf. `doc/plugin-protocol.md`
  §6.4). La convention part de l'**extension** : latex-doc déclare donc
  `tex-source` et `latex-source` pour la même grammaire. Le point délicat est `hlsplit.js` : un coloriseur rend **un** flot HTML
  où un `<span>` chevauche les lignes (fence, chaîne, commentaire), qu'il faut
  recouper en refermant/rouvrant la pile de spans. Module pur, testé hors
  navigateur par `node tests/test_hlsplit.mjs` (accepte des `.md` en arguments).
  Toute anomalie (découpe qui ne recouvre pas les lignes, erreur de grammaire,
  vue rebasculée entre-temps) laisse la vue en texte brut : **l'alignement prime
  sur la couleur**. Conséquence pour les recherches : une ligne colorée est
  éclatée en plusieurs nœuds texte, d'où `textmatch.js` qui recolle les nœuds
  d'une même `.src-line` avant de chercher (hors vue source, chaque nœud reste
  isolé — sinon des occurrences fantômes apparaîtraient entre deux blocs).
- **Composants des plugins de document** : un plugin qui émet du HTML inline
  (accordéons, encarts) s'appuie sur les classes génériques `kd-fold`
  (`<details>` dépliable) et `kd-note` (encart de documentation), stylées dans
  `ui/css/app.css` et documentées au §6.7 du protocole — l'hôte ne porte aucune
  classe propre à un plugin. Un lien relatif `doc#fragment` émis dans un SVG
  (`xlink:href`) est cliquable comme un lien markdown (`initLinks`,
  `main.js`), fragment mémorisé dans `pendingAnchor` et consommé par
  `showActive`.
- **Fichiers `.tex`/`.latex`** (documents LaTeX **autonomes**) : servis par le
  **plugin `latex-doc`** (`plugins/latex-doc/tex.js`), qui génère un markdown
  dérivé (mêmes ancres/`remapLine` via `anchors.js`) ; une fence ` ```latex `
  dans un `.md` reçoit le même rendu (`fence:markdown`, sans titre de tête) —
  ` ```tex ` n'est volontairement **pas** revendiqué, il reste disponible pour
  afficher du code LaTeX. Principe : le plugin **ne rend aucune formule**, il
  délimite en `$…$`/`$$…$$` et laisse le KaTeX de l'hôte faire. Trois mécanismes
  portent la fidélité : **double parse** (le premier collecte les
  `\newcommand`/`\newtheorem` du préambule, le second re-parse en déclarant ces
  signatures au parseur — sans quoi `\hyp{h:iid}` serait lu comme une macro
  suivie d'un groupe indépendant), **expansion** des macros utilisateur avant
  KaTeX qui ne les connaît pas, et **marqueurs de référence** opaques résolus en
  fin de parcours (les `\ref` en avant fonctionnent en une seule passe).
  Numérotation maison des sections, des équations (`\tag{n}`) et des théorèmes
  `amsthm` (compteurs partagés `[theorem]`, parents `[section]`) ; ancres
  `<div id="…">` avant chaque objet numéroté — un `<div>` (bloc) évite le `<p>`
  parasite qu'un `<a>` inline produirait, et `initLinks` (`main.js`) résout les
  `href="#id"`. Chaque ancre numérotée (`eq-3`, `sec-2-1`) est **doublée** du ou
  des `\label{}` qui la visent, repris **verbatim** (`#eq:sigmaU`) : seule cible
  stable pour un lien venu d'un autre document
  (`[…](../doc/modele.tex#eq:sigmaU)`, `CSS.escape` gère le `:`), l'ancre
  numérotée se décalant à la moindre insertion en amont. La greffe se fait *sur*
  la ligne d'ancre existante — aucune ligne créée, donc `anchors` (synchro
  preview ↔ source) reste exact ; `removeLine` réaccorde l'index des ancres au
  même titre que celui des lignes.
  ⚠ Dissymétrie de l'AST dans `tabular` : le `&` **séparateur** de
  cellule est un nœud `string`, le `\&` littéral est une macro. Le parseur
  `unified-latex` est vendoré (`vendor/unified-latex.esm.js`, ~245 Ko,
  régénérable par `build_vendor.py`). `texToMarkdown` ne lève jamais. Limites
  assumées : fichier unique (pas de `\input` — pas de `read:siblings`), pas de
  bibliographie (cf. README du plugin). Une `tikzpicture` devient une fence
  ` ```tikz ` contenant un **document autonome** (`tikzPreamble` : paquets en
  liste blanche, `babel` exclu, macros et bibliothèques du préambule, `\newlabel`
  des `\ref` résolus par les marqueurs `t`) que l'hôte compile (moteur TeX) ;
  texte des nœuds et source restent repliés dessous, pour le poste sans TeX.
- **Fichiers `.html`/`.htm`** (pages statiques, dont les exports HTML de l'app,
  3.9.0) : extensions **natives** (`DOC_EXTENSIONS` dans `manager.rs`, miroir
  `NATIVE_DOC_EXTENSIONS` dans `plugins.js` — garder les deux en phase), mais
  **hors pipeline markdown** : `renderActive` (`main.js`) route vers
  `renderHtmlDocument` (`render.js`) qui affiche la page telle quelle dans une
  iframe `srcdoc` sandboxée (`sandbox=""` : aucun script, aucune navigation ;
  la CSP de l'app, héritée par le document srcdoc, s'applique en plus). La vue
  porte `v.kind === "html"` et `v.markdown = null` : pile d'actions de vue
  masquée (pas de source/sommaire/export/pleine largeur), onglets exclus de la
  recherche globale (`globalsearch.js`). Les ressources relatives d'un HTML
  tiers ne sont pas résolues (about:srcdoc n'a pas de base) — les exports de
  l'app sont autonomes, seule limitation connue : les polices KaTeX.
- **Formules math** : `render.js` branche `markdown-it-texmath` (mode `dollars` :
  `$…$` inline, `$$…$$` display) sur **KaTeX** (`ui/vendor/katex/`), rendu local sans
  réseau ni `eval`. `texmath.js` et `katex.min.js` sont chargés en `<script>`
  classiques dans `index.html` (globals `window.texmath` / `window.katex`) ; le CSS
  KaTeX charge ses polices depuis `vendor/katex/fonts/*.woff2` (seul le woff2 est
  vendoré — Chromium prend le 1ᵉʳ format). La sortie KaTeX (HTML + MathML) traverse
  DOMPurify : le profil `mathMl: true` (cf. `sanitizeHtml`) est requis pour ne pas
  vider le MathML d'accessibilité.
- **Plotly (moteur « live »)** : un bloc ` ```plotly ` est le seul rendu
  **interactif** — il **court-circuite** le pipeline backend/SVG et s'exécute dans la
  webview principale (`hydrateDiagrams`, branche `type === "plotly"`). La spec JSON
  `{data, layout}` est soit inline, soit dans un fichier via `src=chemin.json`, lu par
  la commande backend `read_data_file` (**confinée au dossier du doc** : rejet des chemins
  absolus, canonicalisation des deux côtés + `starts_with` anti-traversée/symlink,
  allowlist `.json` ; même confinement que `plugin_read_sibling`).
  `vendor/plotly.min.js` (~4,8 Mo, UMD → `window.Plotly`) est injecté en `<script>` à la
  première figure (`ensurePlotly`). Aucune CSP à changer : `'unsafe-eval'` y est déjà
  (pour d2) et le script est servi en `'self'`. Le `<div>` survit à DOMPurify, le graphe
  est injecté **après** sanitization (comme les SVG Kroki). Pas concerné par
  `resolve_alias` (ne passe pas par le backend de rendu). **Anti-doublon** : si une
  image (`![…](x.png)`) précède immédiatement un bloc ` ```plotly src=x.json ` de même
  *stem*, c'est son fallback statique (portable hors-app / si Plotly échoue) ; une fois
  le rendu interactif réussi, `hidePairedFallbackImage` masque l'image pour éviter
  d'afficher la figure deux fois. En cas d'échec, le PNG reste visible.
- `ui/renderer/` — page de la webview cachée de rendu et ses moteurs vendorés.
- Vendors (`ui/vendor/`, `ui/renderer/vendor/`) sont des bundles pré-buildés
  committés. `vendor/dbml.js` est un bundle esbuild de `@softwaretechnik/dbml-renderer`
  réduit à `run(src, "dot")` (viz.js exclu). `vendor/excalidraw.esm.js` est un bundle
  esbuild de `@excalidraw/excalidraw` (`exportToSvg` + `restore`, polices `.woff2`/CSS
  exclues : `--loader:.woff2=dataurl --loader:.css=empty`). `erd.js` n'est **pas** un
  vendor : c'est notre parseur maison erd→DOT.

## Système de plugins (3.0.0)

La spec du protocole v1 est **`doc/plugin-protocol.md`** — la relire avant de
toucher à l'hôte ou d'écrire un plugin. Résumé opérationnel :

- Un plugin = dossier `%APPDATA%\kroki-deskapp\plugins\<id>\` (chemin neutre,
  hors identifiant Tauri) avec `manifest.json` ; distribué en archive zip
  `.kdext` (drop sur la fenêtre, double-clic si l'installeur a associé
  l'extension, ligne de commande, ou dialog Plugins → dialog de confiance ; le
  tri « archive vs document » est fait une fois pour toutes dans
  `manager::open_mixed_paths`, entonnoir commun à toutes ces voies ;
  `pack_plugin.py` (racine du dépôt) pour empaqueter). Boucle de dev : copier le dossier
  du plugin directement dans `plugins\<id>\` et relancer l'app.
- **Exécution** : worker sandboxé côté frontend (`ui/js/plugins.js`, runtime
  `ui/js/kd_runtime.js` injecté en blob qui importe l'entry via le protocole
  `plugin://` — d'où `plugin:`/`http://plugin.localhost` en
  `script-src`/`connect-src` de la CSP). Démarrage paresseux, timeouts,
  3 échecs consécutifs → « en panne ». Le backend (`plugins.rs`) n'exécute
  jamais le code des plugins : manifestes, fichiers, confinement.
- **Capacités v1** : `document:markdown` (routage dans `renderActive`,
  dégradé §7.3 = bandeau + source en fence), `fence:svg`/`fence:html`/
  `fence:markdown` (routage dans la règle fence + `hydrateDiagrams` de
  `render.js` ; le natif prime ; le format markdown est re-rendu par
  markdown-it + DOMPurify puis hydraté récursivement, profondeur bornée à 2,
  `data-source-line` dérivés retirés), `highlight:code` (post-pass
  `hydratePluginHighlights`, sanitizé spans `hljs-*`), `read:siblings`
  (`host/readFile` → `plugin_read_sibling`, allowlist `siblingExtensions`). `document:html`/`*:webview`/`runtime:
  "process"` sont **réservés, non implémentés**.
- **Extensions effectives** = `DOC_EXTENSIONS` (natives) ∪ plugins actifs :
  dialog d'ouverture, drops (`drop_target.rs`/`filedrop.js`), `open_link`.
  `plotly` reste natif (fence interceptée avant les plugins).
- **Markdown intermédiaire** : un bouton `{…}` (pile d'actions de vue) affiche
  le markdown généré par le plugin d'un document transformé — brut, liseré
  accent, position réalignée via les ancres. Disponible en release depuis la
  3.12.0, mais **désactivé par défaut** : il s'active dans les Réglages →
  « Icônes affichées » (cf. « Icônes des barres d'outils » ci-dessous) et
  n'apparaît que sur un document effectivement transformé (`v.lineMap`).
- Un plugin first-party vit dans le dépôt (`plugins/`, externalisable) :
  **`latex-doc`** (`.tex`/`.latex` + fence `latex` + coloration
  `tex-source`/`latex-source`). D'autres peuvent y être montés par jonction
  depuis leur propre dépôt (exclus localement, `.git/info/exclude`).
  Tout changement de ces rendus se fait là et se teste en
  copiant le dossier dans `plugins\<id>\`, **sans rebuild de l'app** — sauf si
  l'hôte lui-même change (`ui/js/*` reste embarqué dans le binaire) ; `plugins/`
  n'étant pas embarqué dans le binaire, un changement qui s'y limite **ne
  justifie pas de bump de version de l'application** (le plugin a la sienne).
  `plugins/` contient aussi les **trois exemples pédagogiques** du §12 de la
  spec (`csv-tables`, `barchart`, `ini-highlight`) — un par point d'extension,
  à garder en phase avec le code inline de `doc/plugin-protocol.md`.
- **Plugins livrés avec l'installeur** (3.16.0, spec §9.5) : le MSI embarque les
  `.kdext` des plugins de la stratégie d'embarquement (cf. § « Installeur
  Windows ») et laisse cocher ceux à installer (par défaut : `latex-doc`
  coché, les trois exemples décochés). Le `.deb` embarque les mêmes et retient
  les cochés, faute de pouvoir poser la question (cf. § « Paquet
  Debian/Ubuntu (.deb) »).
  Les cochés atterrissent dans `resource_dir()/bundled-plugins/`, d'où
  `plugins::seed_bundled` les installe et les met à jour au
  démarrage, **avant** `plugins::init()` pour que le premier scan voie l'état
  final. Seule voie d'installation sans dialog de confiance — même installeur
  que l'exe, donc même chaîne de confiance. Trois règles, toutes nécessaires :
  jamais de régression de version (un `.kdext` plus récent posé à la main est
  conservé) ; un plugin supprimé depuis le dialog Plugins est mémorisé dans
  `SettingsData::removed_plugins` et **pas** réinstallé — sans quoi « Supprimer »
  serait annulé au lancement suivant ; le réinstaller à la main efface cette
  mémoire. Le dossier des plugins étant per-user et les deux installeurs
  per-machine,
  l'installation ne peut pas être faite par l'installeur : elle a lieu au
  premier lancement de chaque session utilisateur. Build portable = dossier
  absent = no-op. Décocher un plugin **n'en désinstalle pas** un déjà présent :
  le seeding ajoute et met à jour, jamais ne retire — le choix se fait à
  l'installation, la suppression depuis le dialog Plugins. La liste n'est
  qu'en **un** endroit, la stratégie d'embarquement : fragment WiX et overlay
  `.deb` en sont générés. **Test sans
  installeur** : déposer les `.kdext` dans
  `src-tauri/target/debug/bundled-plugins/` —
  `resource_dir()` est le dossier de l'exécutable, y compris en debug.
- **File d'installation** : les voies d'ajout d'un `.kdext` (drop Windows,
  double-clic, ligne de commande, sélecteur natif) **empilent** l'archive côté
  Rust (`plugins::request_install`) et n'émettent `plugin-install-request` que
  comme signal ; le frontend récupère la charge utile par
  `take_pending_plugin_installs`. Ce détour est nécessaire : une archive passée
  au lancement est traitée dans le `setup`, donc **avant** que la webview ait
  enregistré son écouteur — un événement porteur du chemin serait perdu, et le
  double-clic ne ferait rien tant que l'application n'est pas déjà ouverte.
  `drainPendingInstalls` (`plugins_ui.js`) vide la file après le `listen` et
  enchaîne les dialogs de confiance en séquence.

## Sécurité / CSP (ne pas casser)

- Le HTML inline des documents passe par **DOMPurify**. Les SVG des moteurs sont
  insérés **tels quels** (DOMPurify viderait les `<foreignObject>` de mermaid) ; la
  CSP (pas d'`'unsafe-inline'` pour les scripts) neutralise tout `<script>` injecté.
- La CSP autorise `'unsafe-eval'` + workers `blob:` **uniquement** parce que le
  runtime WASM de **d2** utilise `new Function` dans un module worker. Ne pas
  ajouter de sink `eval` alimenté par du contenu de document.

## Contraintes plateforme

- **Windows = cible principale** (WebView2, API Win32, `windows_subsystem =
  "windows"`). Linux est supporté en dégradé (WebKitGTK, fallbacks
  `#[cfg(not(windows))]`, pas de drag inter-fenêtres) — builds via
  `scripts/Dockerfile.linux` (cf. « Builds Linux »).
- Profil release agressif (`lto`, `codegen-units=1`, `panic=abort`, `opt-level=s`,
  `strip`) → builds release lents ; préférer `cargo run` (debug) en développement.
