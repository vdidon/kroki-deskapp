#!/usr/bin/env bash
# Builds the Linux AppImage (a single file, GTK/WebKitGTK embedded) via the
# Tauri bundler. Designed to run in the scripts/Dockerfile.linux container:
#   docker run --rm -v ${PWD}:/app -v kroki_target:/target -v kroki_cargo:/usr/local/cargo/registry \
#     kroki-linux-build bash /app/scripts/linux_appimage_build.sh
#
# Mere container wrapper around the `cargo build-appimage` alias (see
# .cargo/config.toml and xtask/): targets the /target volume. All the logic
# (tauri-cli bootstrap, config overlay, APPIMAGE_EXTRACT_AND_RUN,
# publication into dist/ — versioned AppImage + unversioned link) lives in
# xtask/src/main.rs.
set -eu

export CARGO_TARGET_DIR=/target

cd /app
cargo build-appimage

echo "== AppImage available in dist/ (versioned + unversioned twin) =="
