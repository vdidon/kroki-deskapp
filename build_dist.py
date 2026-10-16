#!/usr/bin/env python3
"""Génère l'intégralité des artefacts de distribution de la version dans
dist/, en une seule commande, depuis Windows ou Linux.

Tout est produit par défaut ; chaque étape se retire par son --skip-*, ou
s'isole par son --*-only. Chaque artefact est publié postfixé de la version
(source de vérité : src-tauri/Cargo.toml) et doublé d'un fichier non versionné
pointant sur le même contenu (hardlink, copie en repli — cf. publish_dist dans
xtask/src/main.rs) :
  - les .kdext de tous les plugins de plugins/ (tout dossier contenant un
    manifest.json, jonctions comprises), via pack_plugin.py : <id>-<version>.kdext ;
  - le binaire natif de l'hôte (cargo build-app) : kroki_deskapp-<version>.exe
    sur Windows, kroki_deskapp-<version>-linux-<arch>-<distro> sur Linux ;
  - l'installeur MSI Windows (cargo build-msi, WiX v3, overlay
    src-tauri/tauri.msi.conf.json) : kroki_deskapp-<version>.msi — Windows
    uniquement, sauté d'office ailleurs ;
  - le binaire Linux "nu" (semi-dynamique, glibc bookworm, nécessite
    libwebkit2gtk-4.1 sur la machine cible) :
    kroki_deskapp-<version>-linux-x86_64-debian12 — via l'image Docker ;
  - l'AppImage autonome (GTK/WebKitGTK embarqués, bundlée par tauri-cli) :
    kroki_deskapp-<version>-linux-x86_64-debian12.AppImage — via l'image Docker ;
  - le paquet Debian/Ubuntu, pendant Linux du MSI (cargo build-deb, overlay
    src-tauri/tauri.deb.conf.json) :
    kroki_deskapp-<version>-linux-x86_64-debian12.deb — via l'image Docker, y
    compris sur un hôte Linux : le paquet distribuable est celui compilé sur
    bookworm, dont le plancher glibc est le plus bas.

Tout artefact Linux est suffixé de la distro qui l'a compilé (tag lu dans
/etc/os-release par le xtask : debian12 pour le conteneur, ubuntu24.04 pour un
hôte Ubuntu…) — un build natif et un build Docker ne s'écrasent donc jamais
dans dist/ ; le distribuable est le -debian12 (compatibilité glibc large).

L'ordre est celui du coût croissant, pour qu'une étape lente ou en panne ne
puisse ni retarder ni empêcher un artefact bon marché : les plugins (quelques
centaines de ms, ni cargo ni Docker), puis le binaire natif, puis le MSI, puis
seulement les étapes Docker.

Le MSI et le .deb embarquent les .kdext des plugins : leur build échoue si les
archives manquent de dist/. --skip-plugins les fait donc réutiliser celles d'un
build précédent, il ne les retire pas de l'installeur.

Les builds Docker passent par l'image kroki-linux-build (daemon Docker démarré
requis, sauf --skip-binary --skip-appimage --skip-deb). Le test runtime headless
(Xvfb + API Kroki locale) est optionnel (--test).

Exemples :
    python build_dist.py                            # tous les artefacts
    python build_dist.py --test                     # idem + test headless
    python build_dist.py --skip-msi --skip-deb      # sans les installeurs
    python build_dist.py --skip-native --skip-appimage --skip-msi --skip-deb
                                                    # juste le binaire Linux nu
    python build_dist.py --native-only              # juste le binaire natif (aucun Docker)
    python build_dist.py --plugins-only             # juste les .kdext (ni cargo ni Docker)
    python build_dist.py --msi-only                 # juste les .kdext + le MSI (aucun Docker)
    python build_dist.py --msi-only --skip-plugins  # juste le MSI, .kdext de dist/ réutilisés
    python build_dist.py --deb-only                 # juste les .kdext + le .deb (Docker)
    python build_dist.py --compile-only             # vérif compilation Linux seule
"""

import argparse
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent
IMAGE_NAME = "kroki-linux-build"
# Indirection volontaire : testé directement, `sys.platform` est narrowé
# statiquement par les type-checkers, qui déclarent alors mort le code de
# l'autre plateforme.
IS_WINDOWS = sys.platform == "win32"
COMMON_VOLUMES = [
    "-v", f"{REPO_ROOT}:/app",
    "-v", "kroki_target:/target",
    "-v", "kroki_cargo:/usr/local/cargo/registry",
]

# Les étapes, dans l'ordre d'exécution. Chacune a un --skip-<étape>.
STEPS = ("plugins", "native", "msi", "appimage", "binary", "deb")

# Chaque --<x>-only : l'étape qu'il isole (celle dont le --skip- le
# contredirait) et l'ensemble des étapes qu'il conserve. --compile-only n'en
# garde aucune : il ne produit aucun artefact.
ONLY_MODES = {
    "native_only": ("native", {"native"}),
    "plugins_only": ("plugins", {"plugins"}),
    "msi_only": ("msi", {"plugins", "msi"}),
    "deb_only": ("deb", {"plugins", "deb"}),
    "compile_only": (None, set()),
}

USE_COLOR = sys.stdout.isatty()


def say(msg: str, color: str = "36") -> None:
    print(f"\x1b[{color}m{msg}\x1b[0m" if USE_COLOR else msg, flush=True)


def flag(name: str) -> str:
    """Nom d'option tel que l'utilisateur l'a tapé : skip_msi -> --skip-msi."""
    return "--" + name.replace("_", "-")


def run(cmd: list[str], **kwargs) -> None:
    result = subprocess.run(cmd, cwd=REPO_ROOT, **kwargs)
    if result.returncode != 0:
        sys.exit(f"Commande en échec (exit {result.returncode}) : {' '.join(cmd)}")


def assert_docker_running() -> None:
    probe = subprocess.run(
        ["docker", "version", "--format", "{{.Server.Version}}"],
        capture_output=True,
    )
    if probe.returncode != 0:
        sys.exit("Le daemon Docker ne répond pas (arrêté ?). Démarre-le puis relance ce script.")


def project_version() -> str:
    content = (REPO_ROOT / "src-tauri" / "Cargo.toml").read_text(encoding="utf-8")
    m = re.search(r'^version\s*=\s*"([^"]+)"', content, re.MULTILINE)
    if not m:
        sys.exit("Impossible de lire la version dans src-tauri/Cargo.toml")
    return m.group(1)


def pack_plugins() -> None:
    """Empaquette en .kdext tout dossier de plugins/ portant un manifest.json.

    Délégué à pack_plugin.py (une invocation par plugin) : c'est lui qui porte
    la convention `packInclude` et la publication versionnée + twin dans dist/.
    Une jonction cassée (plugin vivant dans un dépôt absent) n'a pas de
    manifest lisible : elle est simplement ignorée, pas une erreur.
    """
    plugins_root = REPO_ROOT / "plugins"
    plugin_dirs = sorted(
        d for d in plugins_root.iterdir() if (d / "manifest.json").is_file()
    ) if plugins_root.is_dir() else []
    if not plugin_dirs:
        sys.exit("Aucun plugin empaquetable : pas de dossier avec manifest.json dans plugins/.")

    say(f"== Empaquetage des plugins ({len(plugin_dirs)}) ==")
    for plugin_dir in plugin_dirs:
        run([sys.executable, str(REPO_ROOT / "pack_plugin.py"), str(plugin_dir)])
    say(f"== {len(plugin_dirs)} plugin(s) publiés dans dist/ (versionné + twin) ==", "32")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--skip-image-build", action="store_true",
                        help="ne pas reconstruire l'image Docker (rapide de toute façon grâce au cache de layers)")
    parser.add_argument("--skip-plugins", action="store_true",
                        help="ne pas (ré)empaqueter les .kdext des plugins ; le MSI et le .deb réutilisent alors ceux déjà dans dist/")
    parser.add_argument("--skip-native", action="store_true",
                        help="ne pas builder le binaire natif de l'hôte")
    parser.add_argument("--skip-msi", action="store_true",
                        help="ne pas construire l'installeur MSI (sans effet hors Windows, où il est sauté d'office)")
    parser.add_argument("--skip-appimage", action="store_true",
                        help="ne pas construire l'AppImage")
    parser.add_argument("--skip-binary", action="store_true",
                        help="ne pas extraire le binaire Linux nu dans dist/")
    parser.add_argument("--skip-deb", action="store_true",
                        help="ne pas construire le paquet Debian/Ubuntu .deb")
    parser.add_argument("--native-only", action="store_true",
                        help="ne builder que le binaire natif de l'hôte (aucun Docker requis)")
    parser.add_argument("--plugins-only", action="store_true",
                        help="n'empaqueter que les plugins (aucun cargo, aucun Docker)")
    parser.add_argument("--msi-only", action="store_true",
                        help="ne construire que les plugins et le MSI (aucun Docker)")
    parser.add_argument("--deb-only", action="store_true",
                        help="ne construire que les plugins et le .deb (Docker requis)")
    parser.add_argument("--compile-only", action="store_true",
                        help="juste un `cargo build` (debug) de vérification dans le conteneur, aucun artefact")
    parser.add_argument("--test", action="store_true",
                        help="après le build, test runtime headless sur l'AppImage (ou le binaire nu si --skip-appimage)")
    args = parser.parse_args()

    # Mémorisé avant que les --*-only ne forcent les autres skips, pour que les
    # messages « sauté » nomment l'option réellement tapée.
    explicit_skips = {s for s in STEPS if getattr(args, f"skip_{s}")}

    selected = [name for name in ONLY_MODES if getattr(args, name)]
    if len(selected) > 1:
        parser.error("les options --*-only s'excluent : " + ", ".join(flag(n) for n in selected))

    only_flag = None
    if selected:
        only_flag = flag(selected[0])
        isolated, kept = ONLY_MODES[selected[0]]
        if args.test:
            parser.error(f"{only_flag} est incompatible avec --test")
        if isolated in explicit_skips:
            parser.error(f"{only_flag} est incompatible avec {flag('skip_' + isolated)}")
        for step in STEPS:
            if step not in kept:
                setattr(args, f"skip_{step}", True)

    # WiX v3 ne tourne que sous Windows : ailleurs, le MSI est hors sujet, pas
    # une erreur — sauf s'il est explicitement le seul artefact demandé.
    msi_skip_reason = None
    if not IS_WINDOWS and not args.skip_msi:
        if args.msi_only:
            parser.error("--msi-only : l'installeur MSI ne se construit que sous Windows (WiX v3 n'y tourne que là)")
        args.skip_msi = True
        msi_skip_reason = "WiX v3 ne tourne que sous Windows"

    def skipped(label: str, step: str, reason: str | None = None) -> None:
        if reason is None:
            reason = flag(f"skip_{step}") if step in explicit_skips else (only_flag or flag(f"skip_{step}"))
        say(f"== {label} : sauté ({reason}) ==", "33")

    needs_docker = (
        args.compile_only
        or not args.skip_binary
        or not args.skip_appimage
        or not args.skip_deb
        or args.test
    )

    (REPO_ROOT / "dist").mkdir(exist_ok=True)

    # Les plugins d'abord : quelques centaines de ms, sans cargo ni Docker.
    # Même logique que pour le natif ci-dessous, en plus fort — rien de ce qui
    # suit ne doit pouvoir retarder ou empêcher un artefact aussi bon marché.
    if args.skip_plugins:
        skipped("Plugins", "plugins")
    else:
        pack_plugins()
    if args.plugins_only:
        return

    # Le natif ensuite : c'est l'artefact le plus rapide à obtenir et celui
    # qu'on attend le plus souvent. Une étape Docker lente ou en panne (daemon
    # arrêté, image à retélécharger) ne doit ni le retarder ni l'empêcher.
    if args.skip_native:
        skipped("Binaire natif", "native")
    else:
        say("== Build natif (cargo build-app, release LTO : compter ~2 min) ==")
        run(["cargo", "build-app"])
        say("== Binaire natif publié dans dist/ (versionné + twin, cf. publish_dist) ==", "32")
    if args.native_only:
        return

    # Le MSI après le natif : il relance un build release, qui est alors un
    # no-op. Avant Docker, comme le natif — c'est un artefact Windows, rien de
    # ce qui suit ne doit pouvoir l'empêcher.
    if args.skip_msi:
        skipped("Installeur MSI", "msi", msi_skip_reason)
    else:
        say("== Build de l'installeur MSI (cargo build-msi, WiX v3) ==")
        run(["cargo", "build-msi"])
        say("== MSI publié dans dist/ (versionné + twin) ==", "32")
    if args.msi_only:
        return

    if needs_docker:
        say("== Vérification du daemon Docker ==")
        assert_docker_running()

        if not args.skip_image_build:
            say(f"== Construction de l'image {IMAGE_NAME} ==")
            run(["docker", "build", "-t", IMAGE_NAME, "-f", "scripts/Dockerfile.linux", "."])
        else:
            say("== Image Docker : build sauté (--skip-image-build) ==", "33")

    if args.compile_only:
        say("== Compilation seule (cargo build) ==")
        run(["docker", "run", "--rm", *COMMON_VOLUMES,
             "-e", "CARGO_TARGET_DIR=/target", IMAGE_NAME, "cargo", "build"])
        say("== Compilation OK ==", "32")
        return

    version = project_version()

    if args.skip_appimage:
        skipped("AppImage", "appimage")
    else:
        say("== Build de l'AppImage ==")
        run(["docker", "run", "--rm", *COMMON_VOLUMES,
             "-v", "kroki_cache:/root/.cache",
             IMAGE_NAME, "bash", "/app/scripts/linux_appimage_build.sh"])

    linux_binary = None
    if args.skip_binary:
        skipped("Binaire Linux nu", "binary")
    else:
        say("== Extraction du binaire Linux nu (parallèle de kroki_deskapp.exe) ==")
        # cargo build-app (xtask) rebuilde si besoin (no-op si le build AppImage
        # vient de compiler le release) et publie le binaire + le twin non
        # versionné, suffixés du tag distro (debian12 dans le conteneur).
        # -w /app : l'alias build-app pointe xtask/Cargo.toml en relatif — il
        # doit être lancé depuis la racine du dépôt (WORKDIR de l'image = src-tauri/).
        run(["docker", "run", "--rm", "-w", "/app", *COMMON_VOLUMES,
             "-e", "CARGO_TARGET_DIR=/target", IMAGE_NAME, "cargo", "build-app"])
        # Retrouver l'artefact plutôt que deviner le tag (le plus récent, hors
        # AppImage — un éventuel build natif du même hôte est plus ancien).
        candidates = sorted(
            (p for p in (REPO_ROOT / "dist").glob(f"kroki_deskapp-{version}-linux-*")
             if p.suffix not in (".AppImage", ".deb")),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if not candidates:
            sys.exit(f"Build terminé mais aucun binaire Linux version {version} trouvé dans dist/.")
        linux_binary = candidates[0]
        say(f"== Binaire Linux : dist/{linux_binary.name} ==", "32")
        say("   (semi-dynamique : la machine cible doit avoir libwebkit2gtk-4.1 installé ; penser à 'chmod +x' une fois transféré)", "90")

    appimage = None
    if not args.skip_appimage:
        # Cibler l'AppImage versionnée (le xtask publie aussi un twin non versionné).
        candidates = sorted(
            (REPO_ROOT / "dist").glob(f"*-{version}-*.AppImage"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if not candidates:
            sys.exit(f"Build terminé mais aucune AppImage version {version} trouvée dans dist/.")
        appimage = candidates[0]
        say(f"== AppImage produite : {appimage} ==", "32")

    # Le .deb en dernier des artefacts Linux : il relance un build release, qui
    # est alors un no-op si l'AppImage ou le binaire nu vient de compiler, et sa
    # publication ne doit pas s'intercaler dans les recherches d'artefacts
    # ci-dessus (le nom du paquet a le même préfixe que celui du binaire nu).
    if args.skip_deb:
        skipped("Paquet .deb", "deb")
    else:
        say("== Build du paquet Debian/Ubuntu (cargo build-deb) ==")
        run(["docker", "run", "--rm", *COMMON_VOLUMES,
             IMAGE_NAME, "bash", "/app/scripts/linux_deb_build.sh"])
        candidates = sorted(
            (REPO_ROOT / "dist").glob(f"kroki_deskapp-{version}-linux-*.deb"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if not candidates:
            sys.exit(f"Build terminé mais aucun paquet .deb version {version} trouvé dans dist/.")
        say(f"== Paquet .deb : dist/{candidates[0].name} ==", "32")
        say("   (installation : sudo apt install ./<paquet>.deb — apt résout les dépendances, pas dpkg -i)", "90")

    if args.test:
        target = appimage or linux_binary
        if target is None:
            sys.exit("--test requiert l'AppImage ou le binaire Linux nu (retirer --skip-appimage ou --skip-binary).")
        test_target = target.name
        say(f"== Test runtime headless sur {test_target} ==")
        run(["docker", "run", "--rm", "-e", f"APP=/app/dist/{test_target}",
             *COMMON_VOLUMES, IMAGE_NAME, "bash", "/app/scripts/linux_runtime_run.sh"])
        say("== Test runtime OK ==", "32")


if __name__ == "__main__":
    main()
