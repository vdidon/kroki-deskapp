# Compiler Kroki Desk

## Prérequis

- **Rust stable** (cargo) — seul outil requis pour le binaire de l'hôte.
- **Python 3.10+** (bibliothèque standard seule) pour `build_dist.py` et
  `pack_plugin.py`.
- **Windows** : WebView2 Runtime (préinstallé sur Windows 10/11). Le MSI
  télécharge WiX v3 dans `%LOCALAPPDATA%\tauri` au premier build.
- **Linux natif** : les paquets système listés dans `scripts/Dockerfile.linux`
  (WebKitGTK 4.1, GTK 3, `xdg-utils`…).
- **Docker** (daemon démarré) pour les artefacts Linux distribuables, y
  compris depuis Windows.
- **Node.js** pour les tests uniquement (scripts ESM sans dépendance npm).

Il n'y a **pas de bundler frontend** : `ui/` est statique, ses dépendances sont
vendorées dans le dépôt. Aucun `npm install`.

## Deux voies

| Besoin | Commande |
| --- | --- |
| Tous les artefacts d'une version | `python build_dist.py` |
| Développer (build debug + lancement) | `cargo run-app` |
| Seulement le binaire de l'hôte | `cargo build-app` |

`build_dist.py` est la voie de référence pour produire une version : il
enchaîne les étapes dans le bon ordre, empaquette les plugins dont les
installeurs ont besoin et vérifie ce qu'ils embarquent. Les alias cargo
restent la boucle de développement, et la voie minimale pour qui veut seulement
l'exécutable.

## `build_dist.py`

Génère, depuis Windows comme depuis Linux, l'intégralité des artefacts dans
`dist/`, dans l'ordre du coût croissant (une étape lente ou en panne ne retarde
pas un artefact bon marché) :

1. les archives `.kdext` de tous les plugins de `plugins/` ;
2. le binaire natif de l'hôte (`.exe` sous Windows, binaire Linux sous Linux) ;
3. l'installeur MSI (Windows uniquement, sauté d'office ailleurs) ;
4. via Docker (image `kroki-linux-build`, Debian bookworm) : l'AppImage, le
   binaire Linux nu et le paquet `.deb`.

Chaque étape se retire par son `--skip-…` (`--skip-plugins`, `--skip-native`,
`--skip-msi`, `--skip-appimage`, `--skip-binary`, `--skip-deb`) ou s'isole par
son `--…-only` (`--native-only`, `--plugins-only`, `--msi-only`, `--deb-only`,
mutuellement exclusifs). S'y ajoutent `--skip-image-build`, `--compile-only`
(compilation Linux de vérification, aucun artefact) et `--test` (test runtime
headless sous Xvfb). Sans Docker : `--skip-appimage --skip-binary --skip-deb`.

Le MSI et le `.deb` embarquent les `.kdext` : `--skip-plugins` leur fait
réutiliser ceux déjà présents dans `dist/`, il ne les retire pas de
l'installeur.

`python build_dist.py --help` liste toutes les options et des exemples.

## Alias cargo

Définis dans `.cargo/config.toml`, ils pilotent le crate `src-tauri/` depuis
la racine du dépôt :

```bash
cargo run-app         # build debug + lance l'app
cargo build-app       # build release → dist/
cargo lint-app        # clippy
cargo fmt-app         # rustfmt
cargo build-msi       # installeur MSI (Windows ; requiert les .kdext dans dist/)
cargo build-appimage  # AppImage (Linux ; installe tauri-cli en local au besoin)
cargo build-deb       # paquet .deb (Linux ; requiert les .kdext dans dist/)
```

Le profil release est agressif (LTO, `codegen-units=1`) : préférer
`cargo run-app` pendant le développement.

## Artefacts dans `dist/`

Chaque artefact est publié **postfixé de la version** (source unique : le champ
`version` de `src-tauri/Cargo.toml`), doublé d'un fichier **non versionné**
pointant sur le même contenu — hardlink si le système de fichiers le permet
(sans droit administrateur, NTFS comme ext4), copie sinon :

```
kroki_deskapp-3.24.0.exe          kroki_deskapp.exe
kroki_deskapp-3.24.0.msi          kroki_deskapp.msi
kroki_deskapp-3.24.0-linux-x86_64-debian12.AppImage   …
```

Les artefacts Linux portent le tag de la distro qui compile (lu dans
`/etc/os-release` : `debian12` pour le conteneur, `ubuntu24.04` pour un hôte
Ubuntu…) : un build natif et un build Docker coexistent dans `dist/`. Le
distribuable est le `-debian12` — glibc bookworm, donc compatibilité large ;
compilé sur une distro plus récente, un binaire ne tourne pas sur plus ancien.

## Plugins embarqués dans les installeurs

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
une stratégie précise. `python build_dist.py --channel public` l'utilise pour
construire avec `bundled-plugins.default.txt` même si un `bundled-plugins.txt`
local existe, et recopie chaque artefact produit dans `dist/public/<version>/`
— le dossier à publier. `--channel local` (défaut) garde le choix ci-dessus ;
`--channel all` enchaîne les deux en une passe. Le script s'arrête si les
archives réellement embarquées dans le MSI ou le `.deb` diffèrent de la
stratégie.

## Outillage Linux (`scripts/`)

- `Dockerfile.linux` — image de build `kroki-linux-build` (Debian bookworm) ;
  commandes `docker run` en en-tête du fichier ;
- `linux_appimage_build.sh` — enrobe `cargo build-appimage` dans le conteneur ;
- `linux_deb_build.sh` — idem pour `cargo build-deb` ;
- `linux_runtime_run.sh` — test runtime headless (Xvfb).

Le build Windows n'est possible que depuis Windows (ni cross-compilation ni
conteneur Windows).

## Tests

Les tests pilotent l'application **en cours d'exécution** via CDP
(`tests/cdp.mjs` et les `tests/test_*.mjs`) ; deux suites tournent sans
application (`tests/test_latex_plugin.mjs`, `tests/test_hlsplit.mjs`).
Mode d'emploi en en-tête de chaque script.
