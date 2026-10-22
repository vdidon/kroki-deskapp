#!/usr/bin/env python3
"""Builds every distribution artifact of the current version into dist/, in a
single command, from Windows or Linux.

Everything is produced by default; each step is removed by its --skip-*, or
isolated by its --*-only. Each artifact is published suffixed with the version
(source of truth: src-tauri/Cargo.toml) and paired with an unversioned file
pointing at the same content (hardlink, copy as a fallback — see publish_dist
in xtask/src/main.rs):
  - the .kdext of every plugin in plugins/ (any folder holding a
    manifest.json, junctions included), via pack_plugin.py: <id>-<version>.kdext;
  - the host's native binary (cargo build-app): kroki_deskapp-<version>.exe
    on Windows, kroki_deskapp-<version>-linux-<arch>-<distro> on Linux;
  - the Windows MSI installer (cargo build-msi, WiX v3, overlay
    src-tauri/tauri.msi.conf.json): kroki_deskapp-<version>.msi — Windows
    only, skipped outright elsewhere;
  - the bare Linux binary (semi-dynamic, bookworm glibc, requires
    libwebkit2gtk-4.1 on the target machine):
    kroki_deskapp-<version>-linux-x86_64-debian12 — via the Docker image;
  - the standalone AppImage (GTK/WebKitGTK embedded, bundled by tauri-cli):
    kroki_deskapp-<version>-linux-x86_64-debian12.AppImage — via the Docker image;
  - the Debian/Ubuntu package, Linux counterpart of the MSI (cargo build-deb,
    overlay src-tauri/tauri.deb.conf.json):
    kroki_deskapp-<version>-linux-x86_64-debian12.deb — via the Docker image,
    even on a Linux host: the distributable package is the one built on
    bookworm, whose glibc floor is the lowest.

Every Linux artifact is suffixed with the distro that built it (tag read from
/etc/os-release by the xtask: debian12 for the container, ubuntu24.04 for an
Ubuntu host…) — a native build and a Docker build therefore never overwrite
each other in dist/; the distributable is the -debian12 (broad glibc
compatibility).

Steps run in order of increasing cost, so that a slow or broken step can
neither delay nor prevent a cheap artifact: the plugins (a few hundred ms,
neither cargo nor Docker), then the native binary, then the MSI, and only then
the Docker steps.

The MSI and the .deb embed the plugins' .kdext: their build fails if the
archives are missing from dist/. --skip-plugins therefore makes them reuse
those of a previous build, it does not remove them from the installer.

Distribution channel (--channel): only the MSI and the .deb depend on the
plugin bundling strategy (see xtask/src/bundled.rs), hence on the channel.
  - local (default): bundled-plugins.txt if it exists, otherwise
    bundled-plugins.default.txt — the workstation's selection;
  - public: bundled-plugins.default.txt, even if a bundled-plugins.txt exists.
The chosen strategy is imposed on the xtask (KROKI_BUNDLED_PLUGINS variable,
also passed to the .deb container). On the public channel, each produced
artifact is also copied into dist/public/<version>/ — exactly what is to be
uploaded: binaries, installers, and only the .kdext of its strategy.
dist/ at the root is overwritten by the last build, whatever its channel;
dist/public/ only receives public builds. --channel all does both in one
pass: binaries and AppImage once (they embed no plugin), MSI and .deb built
twice, public first — dist/ therefore ends up on the local channel's
installers. After the MSI and the .deb, the archives actually embedded
(src-tauri/bundled-plugins/) are compared with the strategy: any mismatch
stops the script.

Docker builds go through the kroki-linux-build image (running Docker daemon
required, unless --skip-binary --skip-appimage --skip-deb). The headless
runtime test (Xvfb + local Kroki API) is optional (--test).

Examples:
    python build_dist.py                            # all artifacts
    python build_dist.py --test                     # same + headless test
    python build_dist.py --skip-msi --skip-deb      # without the installers
    python build_dist.py --skip-native --skip-appimage --skip-msi --skip-deb
                                                    # just the bare Linux binary
    python build_dist.py --native-only              # just the native binary (no Docker)
    python build_dist.py --plugins-only             # just the .kdext (neither cargo nor Docker)
    python build_dist.py --msi-only                 # just the .kdext + the MSI (no Docker)
    python build_dist.py --msi-only --skip-plugins  # just the MSI, .kdext from dist/ reused
    python build_dist.py --deb-only                 # just the .kdext + the .deb (Docker)
    python build_dist.py --compile-only             # Linux compile check only
    python build_dist.py --channel public           # public channel artifacts
    python build_dist.py --channel all              # public and local channels in one pass
"""

import argparse
import os
import re
import shutil
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

# Stratégies d'embarquement des plugins (cf. xtask/src/bundled.rs).
STRATEGY_LOCAL = "bundled-plugins.txt"
STRATEGY_DEFAULT = "bundled-plugins.default.txt"
STRATEGY_ENV = "KROKI_BUNDLED_PLUGINS"
CHANNELS = ("local", "public")

USE_COLOR = sys.stdout.isatty()


def say(msg: str, color: str = "36") -> None:
    print(f"\x1b[{color}m{msg}\x1b[0m" if USE_COLOR else msg, flush=True)


def flag(name: str) -> str:
    """Nom d'option tel que l'utilisateur l'a tapé : skip_msi -> --skip-msi."""
    return "--" + name.replace("_", "-")


def run(cmd: list[str], **kwargs) -> None:
    result = subprocess.run(cmd, cwd=REPO_ROOT, **kwargs)
    if result.returncode != 0:
        sys.exit(f"Command failed (exit {result.returncode}): {' '.join(cmd)}")


def assert_docker_running() -> None:
    probe = subprocess.run(
        ["docker", "version", "--format", "{{.Server.Version}}"],
        capture_output=True,
    )
    if probe.returncode != 0:
        sys.exit("The Docker daemon is not responding (stopped?). Start it, then rerun this script.")


def project_version() -> str:
    content = (REPO_ROOT / "src-tauri" / "Cargo.toml").read_text(encoding="utf-8")
    m = re.search(r'^version\s*=\s*"([^"]+)"', content, re.MULTILINE)
    if not m:
        sys.exit("Cannot read the version from src-tauri/Cargo.toml")
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
        sys.exit("No plugin to pack: no folder with a manifest.json in plugins/.")

    say(f"== Packing plugins ({len(plugin_dirs)}) ==")
    for plugin_dir in plugin_dirs:
        run([sys.executable, str(REPO_ROOT / "pack_plugin.py"), str(plugin_dir)])
    say(f"== {len(plugin_dirs)} plugin(s) published to dist/ (versioned + twin) ==", "32")


def channel_strategy(channel: str) -> Path:
    """Fichier de stratégie d'un canal : le public ignore la sélection du poste."""
    if channel == "local" and (REPO_ROOT / STRATEGY_LOCAL).is_file():
        return REPO_ROOT / STRATEGY_LOCAL
    return REPO_ROOT / STRATEGY_DEFAULT


def strategy_ids(strategy: Path) -> list[str]:
    """Identifiants des plugins d'une stratégie (même lecture que bundled::load)."""
    ids = []
    for raw in strategy.read_text(encoding="utf-8").splitlines():
        words = raw.split("#", 1)[0].split()
        if words:
            ids.append(words[0])
    return ids


def newest(pattern: str, exclude_suffixes: tuple[str, ...] = ()) -> Path | None:
    """Artefact le plus récent de dist/ correspondant au motif."""
    candidates = sorted(
        (p for p in (REPO_ROOT / "dist").glob(pattern)
         if p.is_file() and p.suffix not in exclude_suffixes),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return candidates[0] if candidates else None


def collect(artifact: Path, release_dir: Path | None) -> None:
    """Recopie un artefact dans dist/public/<version>/ (hardlink, copie en
    repli) ; no-op hors canal public, dont les artefacts restent dans dist/."""
    if release_dir is None:
        return
    release_dir.mkdir(parents=True, exist_ok=True)
    target = release_dir / artifact.name
    target.unlink(missing_ok=True)
    try:
        os.link(artifact, target)
    except OSError:
        shutil.copy2(artifact, target)


def collect_plugins(ids: list[str], release_dir: Path | None) -> None:
    """Recopie les .kdext versionnés des seuls plugins de la stratégie."""
    if release_dir is None:
        return
    for plugin_id in ids:
        archive = newest(f"{plugin_id}-[0-9]*.kdext")
        if archive is None:
            sys.exit(f"Versioned archive of \"{plugin_id}\" not found in dist/ "
                     "(rerun without --skip-plugins).")
        collect(archive, release_dir)


def check_staged(ids: list[str], label: str) -> None:
    """Vérifie que l'installeur a embarqué exactement les plugins du canal.

    bundled::stage vide src-tauri/bundled-plugins/ puis y recopie la stratégie
    qu'il a lue : son contenu dit donc ce que le build vient d'embarquer, y
    compris depuis le conteneur du .deb (dépôt monté).
    """
    staged = sorted(p.stem for p in (REPO_ROOT / "src-tauri" / "bundled-plugins").glob("*.kdext"))
    if staged != sorted(ids):
        sys.exit(f"{label}: embedded plugins {staged} ≠ channel strategy {sorted(ids)} "
                 "— do not publish this artifact.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--skip-image-build", action="store_true",
                        help="do not rebuild the Docker image (fast anyway thanks to the layer cache)")
    parser.add_argument("--skip-plugins", action="store_true",
                        help="do not (re)pack the plugins' .kdext; the MSI and the .deb then reuse those already in dist/")
    parser.add_argument("--skip-native", action="store_true",
                        help="do not build the host's native binary")
    parser.add_argument("--skip-msi", action="store_true",
                        help="do not build the MSI installer (no effect outside Windows, where it is always skipped)")
    parser.add_argument("--skip-appimage", action="store_true",
                        help="do not build the AppImage")
    parser.add_argument("--skip-binary", action="store_true",
                        help="do not extract the bare Linux binary into dist/")
    parser.add_argument("--skip-deb", action="store_true",
                        help="do not build the Debian/Ubuntu .deb package")
    parser.add_argument("--native-only", action="store_true",
                        help="build only the host's native binary (no Docker required)")
    parser.add_argument("--plugins-only", action="store_true",
                        help="pack only the plugins (no cargo, no Docker)")
    parser.add_argument("--msi-only", action="store_true",
                        help="build only the plugins and the MSI (no Docker)")
    parser.add_argument("--deb-only", action="store_true",
                        help="build only the plugins and the .deb (Docker required)")
    parser.add_argument("--compile-only", action="store_true",
                        help="just a check `cargo build` (debug) in the container, no artifact")
    parser.add_argument("--channel", choices=(*CHANNELS, "all"), default="local",
                        help="distribution channel: plugin bundling strategy of the MSI/.deb; public = also copies into dist/public/<version>/; all = public then local, installers built twice (default: local)")
    parser.add_argument("--test", action="store_true",
                        help="after the build, headless runtime test on the AppImage (or the bare binary if --skip-appimage)")
    args = parser.parse_args()

    # Mémorisé avant que les --*-only ne forcent les autres skips, pour que les
    # messages « sauté » nomment l'option réellement tapée.
    explicit_skips = {s for s in STEPS if getattr(args, f"skip_{s}")}

    selected = [name for name in ONLY_MODES if getattr(args, name)]
    if len(selected) > 1:
        parser.error("the --*-only options are mutually exclusive: " + ", ".join(flag(n) for n in selected))

    only_flag = None
    if selected:
        only_flag = flag(selected[0])
        isolated, kept = ONLY_MODES[selected[0]]
        if args.test:
            parser.error(f"{only_flag} is incompatible with --test")
        if isolated in explicit_skips:
            parser.error(f"{only_flag} is incompatible with {flag('skip_' + isolated)}")
        for step in STEPS:
            if step not in kept:
                setattr(args, f"skip_{step}", True)

    # WiX v3 ne tourne que sous Windows : ailleurs, le MSI est hors sujet, pas
    # une erreur — sauf s'il est explicitement le seul artefact demandé.
    msi_skip_reason = None
    if not IS_WINDOWS and not args.skip_msi:
        if args.msi_only:
            parser.error("--msi-only: the MSI installer can only be built on Windows (WiX v3 only runs there)")
        args.skip_msi = True
        msi_skip_reason = "WiX v3 only runs on Windows"

    def skipped(label: str, step: str, reason: str | None = None) -> None:
        if reason is None:
            reason = flag(f"skip_{step}") if step in explicit_skips else (only_flag or flag(f"skip_{step}"))
        say(f"== {label}: skipped ({reason}) ==", "33")

    needs_docker = (
        args.compile_only
        or not args.skip_binary
        or not args.skip_appimage
        or not args.skip_deb
        or args.test
    )

    (REPO_ROOT / "dist").mkdir(exist_ok=True)

    # La stratégie du canal est imposée au xtask : sans ça, un poste qui a un
    # bundled-plugins.txt l'embarquerait aussi dans un build public. `all`
    # construit le public d'abord, pour que dist/ finisse sur les installeurs
    # du canal local.
    version = project_version()
    channels = []
    for name in (("public", "local") if args.channel == "all" else (args.channel,)):
        strategy = channel_strategy(name)
        channels.append((name, strategy.relative_to(REPO_ROOT).as_posix(), strategy_ids(strategy)))
        say(f"== Channel {name}: {channels[-1][1]} ({', '.join(channels[-1][2]) or 'no plugin'}) ==")
    public = next((c for c in channels if c[0] == "public"), None)
    # Les artefacts sans plugin (binaires, AppImage) sont les mêmes pour tous
    # les canaux : ils ne sont construits qu'une fois, et recopiés si le canal
    # public en fait partie.
    release_dir = REPO_ROOT / "dist" / "public" / version if public else None

    def per_channel(label: str):
        """Itère les canaux en imposant leur stratégie au xtask (cf. STRATEGY_ENV)."""
        for name, rel, ids in channels:
            os.environ[STRATEGY_ENV] = rel
            if len(channels) > 1:
                say(f"== {label}: {name} channel ==")
            yield name, rel, ids, (release_dir if name == "public" else None)

    # Les plugins d'abord : quelques centaines de ms, sans cargo ni Docker.
    # Même logique que pour le natif ci-dessous, en plus fort — rien de ce qui
    # suit ne doit pouvoir retarder ou empêcher un artefact aussi bon marché.
    if args.skip_plugins:
        skipped("Plugins", "plugins")
    else:
        pack_plugins()
    if public and not (args.skip_plugins and args.skip_msi and args.skip_deb):
        collect_plugins(public[2], release_dir)
    if args.plugins_only:
        return

    # Le natif ensuite : c'est l'artefact le plus rapide à obtenir et celui
    # qu'on attend le plus souvent. Une étape Docker lente ou en panne (daemon
    # arrêté, image à retélécharger) ne doit ni le retarder ni l'empêcher.
    if args.skip_native:
        skipped("Native binary", "native")
    else:
        say("== Native build (cargo build-app, LTO release: allow ~2 min) ==")
        run(["cargo", "build-app"])
        native = (newest(f"kroki_deskapp-{version}.exe") if IS_WINDOWS
                  else newest(f"kroki_deskapp-{version}-linux-*", (".AppImage", ".deb")))
        if native is None:
            sys.exit(f"Build finished but no native binary for version {version} found in dist/.")
        collect(native, release_dir)
        say("== Native binary published to dist/ (versioned + twin, see publish_dist) ==", "32")
    if args.native_only:
        return

    # Le MSI après le natif : il relance un build release, qui est alors un
    # no-op. Avant Docker, comme le natif — c'est un artefact Windows, rien de
    # ce qui suit ne doit pouvoir l'empêcher.
    if args.skip_msi:
        skipped("MSI installer", "msi", msi_skip_reason)
    else:
        for name, _, ids, channel_dir in per_channel("MSI installer"):
            say("== Building the MSI installer (cargo build-msi, WiX v3) ==")
            run(["cargo", "build-msi"])
            check_staged(ids, f"MSI ({name})")
            msi = newest(f"kroki_deskapp-{version}.msi")
            if msi is None:
                sys.exit(f"Build finished but no MSI for version {version} found in dist/.")
            collect(msi, channel_dir)
            say("== MSI published to dist/ (versioned + twin) ==", "32")
    if args.msi_only:
        return

    if needs_docker:
        say("== Checking the Docker daemon ==")
        assert_docker_running()

        if not args.skip_image_build:
            say(f"== Building the {IMAGE_NAME} image ==")
            run(["docker", "build", "-t", IMAGE_NAME, "-f", "scripts/Dockerfile.linux", "."])
        else:
            say("== Docker image: build skipped (--skip-image-build) ==", "33")

    if args.compile_only:
        say("== Compile only (cargo build) ==")
        run(["docker", "run", "--rm", *COMMON_VOLUMES,
             "-e", "CARGO_TARGET_DIR=/target", IMAGE_NAME, "cargo", "build"])
        say("== Compile OK ==", "32")
        return

    if args.skip_appimage:
        skipped("AppImage", "appimage")
    else:
        say("== Building the AppImage ==")
        run(["docker", "run", "--rm", *COMMON_VOLUMES,
             "-v", "kroki_cache:/root/.cache",
             IMAGE_NAME, "bash", "/app/scripts/linux_appimage_build.sh"])

    linux_binary = None
    if args.skip_binary:
        skipped("Bare Linux binary", "binary")
    else:
        say("== Extracting the bare Linux binary (counterpart of kroki_deskapp.exe) ==")
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
            sys.exit(f"Build finished but no Linux binary for version {version} found in dist/.")
        linux_binary = candidates[0]
        collect(linux_binary, release_dir)
        say(f"== Linux binary: dist/{linux_binary.name} ==", "32")
        say("   (semi-dynamic: the target machine must have libwebkit2gtk-4.1 installed; remember to 'chmod +x' it once transferred)", "90")

    appimage = None
    if not args.skip_appimage:
        # Cibler l'AppImage versionnée (le xtask publie aussi un twin non versionné).
        candidates = sorted(
            (REPO_ROOT / "dist").glob(f"*-{version}-*.AppImage"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if not candidates:
            sys.exit(f"Build finished but no AppImage for version {version} found in dist/.")
        appimage = candidates[0]
        collect(appimage, release_dir)
        say(f"== AppImage built: {appimage} ==", "32")

    # Le .deb en dernier des artefacts Linux : il relance un build release, qui
    # est alors un no-op si l'AppImage ou le binaire nu vient de compiler, et sa
    # publication ne doit pas s'intercaler dans les recherches d'artefacts
    # ci-dessus (le nom du paquet a le même préfixe que celui du binaire nu).
    if args.skip_deb:
        skipped(".deb package", "deb")
    else:
        for name, rel, ids, channel_dir in per_channel(".deb package"):
            say("== Building the Debian/Ubuntu package (cargo build-deb) ==")
            run(["docker", "run", "--rm", *COMMON_VOLUMES,
                 "-e", f"{STRATEGY_ENV}={rel}",
                 IMAGE_NAME, "bash", "/app/scripts/linux_deb_build.sh"])
            check_staged(ids, f".deb ({name})")
            deb = newest(f"kroki_deskapp-{version}-linux-*.deb")
            if deb is None:
                sys.exit(f"Build finished but no .deb package for version {version} found in dist/.")
            collect(deb, channel_dir)
            say(f"== .deb package: dist/{deb.name} ==", "32")
        say("   (install: sudo apt install ./<package>.deb — apt resolves dependencies, dpkg -i does not)", "90")

    if args.test:
        target = appimage or linux_binary
        if target is None:
            sys.exit("--test requires the AppImage or the bare Linux binary (remove --skip-appimage or --skip-binary).")
        test_target = target.name
        say(f"== Headless runtime test on {test_target} ==")
        run(["docker", "run", "--rm", "-e", f"APP=/app/dist/{test_target}",
             *COMMON_VOLUMES, IMAGE_NAME, "bash", "/app/scripts/linux_runtime_run.sh"])
        say("== Runtime test OK ==", "32")

    if release_dir is not None and release_dir.is_dir():
        say(f"== Public channel: dist/public/{version}/ ==", "32")
        for artifact in sorted(release_dir.iterdir()):
            say(f"   {artifact.name}", "90")


if __name__ == "__main__":
    main()
