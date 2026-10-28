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
# Deliberate indirection: tested directly, `sys.platform` is narrowed
# statically by type checkers, which then declare the other platform's code
# dead.
IS_WINDOWS = sys.platform == "win32"
COMMON_VOLUMES = [
    "-v", f"{REPO_ROOT}:/app",
    "-v", "kroki_target:/target",
    "-v", "kroki_cargo:/usr/local/cargo/registry",
]

# The steps, in execution order. Each has a --skip-<step>.
STEPS = ("plugins", "native", "msi", "appimage", "binary", "deb")

# Each --<x>-only: the step it isolates (the one whose --skip- would
# contradict it) and the set of steps it keeps. --compile-only keeps none:
# it produces no artifact.
ONLY_MODES = {
    "native_only": ("native", {"native"}),
    "plugins_only": ("plugins", {"plugins"}),
    "msi_only": ("msi", {"plugins", "msi"}),
    "deb_only": ("deb", {"plugins", "deb"}),
    "compile_only": (None, set()),
}

# Plugin bundling strategies (see xtask/src/bundled.rs).
STRATEGY_LOCAL = "bundled-plugins.txt"
STRATEGY_DEFAULT = "bundled-plugins.default.txt"
STRATEGY_ENV = "KROKI_BUNDLED_PLUGINS"
CHANNELS = ("local", "public")

USE_COLOR = sys.stdout.isatty()


def say(msg: str, color: str = "36") -> None:
    print(f"\x1b[{color}m{msg}\x1b[0m" if USE_COLOR else msg, flush=True)


def flag(name: str) -> str:
    """Option name as the user typed it: skip_msi -> --skip-msi."""
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
    """Packs into a .kdext every plugins/ folder holding a manifest.json.

    Delegated to pack_plugin.py (one invocation per plugin): it carries the
    `packInclude` convention and the versioned + twin publication into dist/.
    A broken junction (plugin living in a missing repo) has no readable
    manifest: it is simply ignored, not an error.
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
    """Strategy file of a channel: the public one ignores the workstation's selection."""
    if channel == "local" and (REPO_ROOT / STRATEGY_LOCAL).is_file():
        return REPO_ROOT / STRATEGY_LOCAL
    return REPO_ROOT / STRATEGY_DEFAULT


def strategy_ids(strategy: Path) -> list[str]:
    """Plugin ids of a strategy (same reading as bundled::load)."""
    ids = []
    for raw in strategy.read_text(encoding="utf-8").splitlines():
        words = raw.split("#", 1)[0].split()
        if words:
            ids.append(words[0])
    return ids


def newest(pattern: str, exclude_suffixes: tuple[str, ...] = ()) -> Path | None:
    """Most recent artifact in dist/ matching the pattern."""
    candidates = sorted(
        (p for p in (REPO_ROOT / "dist").glob(pattern)
         if p.is_file() and p.suffix not in exclude_suffixes),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    return candidates[0] if candidates else None


def collect(artifact: Path, release_dir: Path | None) -> None:
    """Copies an artifact into dist/public/<version>/ (hardlink, copy as a
    fallback); no-op outside the public channel, whose artifacts stay in dist/."""
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
    """Copies the versioned .kdext of the strategy's plugins only."""
    if release_dir is None:
        return
    for plugin_id in ids:
        archive = newest(f"{plugin_id}-[0-9]*.kdext")
        if archive is None:
            sys.exit(f"Versioned archive of \"{plugin_id}\" not found in dist/ "
                     "(rerun without --skip-plugins).")
        collect(archive, release_dir)


def check_staged(ids: list[str], label: str) -> None:
    """Checks that the installer embedded exactly the channel's plugins.

    bundled::stage empties src-tauri/bundled-plugins/ then copies back the
    strategy it read: its content therefore says what the build just embedded,
    including from the .deb container (mounted repo).
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

    # Recorded before the --*-only options force the other skips, so that the
    # "skipped" messages name the option actually typed.
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

    # WiX v3 only runs on Windows: elsewhere, the MSI is out of scope, not an
    # error — unless it is explicitly the only artifact requested.
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

    # The channel's strategy is imposed on the xtask: without that, a
    # workstation that has a bundled-plugins.txt would embed it in a public
    # build too. `all` builds the public one first, so that dist/ ends up on
    # the local channel's installers.
    version = project_version()
    channels = []
    for name in (("public", "local") if args.channel == "all" else (args.channel,)):
        strategy = channel_strategy(name)
        channels.append((name, strategy.relative_to(REPO_ROOT).as_posix(), strategy_ids(strategy)))
        say(f"== Channel {name}: {channels[-1][1]} ({', '.join(channels[-1][2]) or 'no plugin'}) ==")
    public = next((c for c in channels if c[0] == "public"), None)
    # Artifacts without plugins (binaries, AppImage) are the same for every
    # channel: they are built only once, and copied over if the public channel
    # is among them.
    release_dir = REPO_ROOT / "dist" / "public" / version if public else None

    def per_channel(label: str):
        """Iterates over the channels, imposing their strategy on the xtask (see STRATEGY_ENV)."""
        for name, rel, ids in channels:
            os.environ[STRATEGY_ENV] = rel
            if len(channels) > 1:
                say(f"== {label}: {name} channel ==")
            yield name, rel, ids, (release_dir if name == "public" else None)

    # Plugins first: a few hundred ms, neither cargo nor Docker. Same logic as
    # for the native binary below, only stronger — nothing that follows must be
    # able to delay or prevent an artifact this cheap.
    if args.skip_plugins:
        skipped("Plugins", "plugins")
    else:
        pack_plugins()
    if public and not (args.skip_plugins and args.skip_msi and args.skip_deb):
        collect_plugins(public[2], release_dir)
    if args.plugins_only:
        return

    # The native binary next: it is the fastest artifact to get and the one
    # most often awaited. A slow or broken Docker step (daemon stopped, image
    # to re-download) must neither delay nor prevent it.
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

    # The MSI after the native binary: it reruns a release build, which is then
    # a no-op. Before Docker, like the native binary — it is a Windows
    # artifact, nothing that follows must be able to prevent it.
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
        # cargo build-app (xtask) rebuilds if needed (no-op if the AppImage build
        # has just compiled the release) and publishes the binary + the
        # unversioned twin, suffixed with the distro tag (debian12 in the
        # container).
        # -w /app: the build-app alias points to xtask/Cargo.toml relatively — it
        # must be run from the repository root (image WORKDIR = src-tauri/).
        run(["docker", "run", "--rm", "-w", "/app", *COMMON_VOLUMES,
             "-e", "CARGO_TARGET_DIR=/target", IMAGE_NAME, "cargo", "build-app"])
        # Find the artifact rather than guess the tag (the most recent, excluding
        # AppImage — any native build on the same host is older).
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
        # Target the versioned AppImage (the xtask also publishes an unversioned twin).
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

    # The .deb last of the Linux artifacts: it reruns a release build, which is
    # then a no-op if the AppImage or the bare binary has just compiled, and its
    # publication must not slip into the artifact lookups above (the package
    # name has the same prefix as the bare binary's).
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
