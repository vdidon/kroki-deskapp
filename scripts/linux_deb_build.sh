#!/usr/bin/env bash
# Builds the Debian/Ubuntu package (.deb) via the Tauri bundler. Designed to
# run in the scripts/Dockerfile.linux container:
#   docker run --rm -v ${PWD}:/app -v kroki_target:/target -v kroki_cargo:/usr/local/cargo/registry \
#     kroki-linux-build bash /app/scripts/linux_deb_build.sh
#
# Mere container wrapper around the `cargo build-deb` alias (see .cargo/config.toml
# and xtask/): targets the /target volume. All the logic (tauri-cli bootstrap,
# copying the .kdext into src-tauri/bundled-plugins/, config overlay,
# publication into dist/ — versioned package + unversioned file) lives in
# xtask/src/main.rs.
#
# Unlike the AppImage, no external tool is downloaded: the bundler assembles
# the ar archive itself. No ~/.cache volume to mount.
set -eu

export CARGO_TARGET_DIR=/target

cd /app
cargo build-deb

echo "== .deb package available in dist/ (versioned + unversioned twin) =="
