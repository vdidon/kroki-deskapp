#!/usr/bin/env bash
# Construit l'AppImage Linux (un seul fichier, GTK/WebKitGTK embarqués) via le
# bundler Tauri. Conçu pour tourner dans le conteneur scripts/Dockerfile.linux :
#   docker run --rm -v ${PWD}:/app -v kroki_target:/target -v kroki_cargo:/usr/local/cargo/registry \
#     kroki-linux-build bash /app/scripts/linux_appimage_build.sh
#
# Simple enrobage conteneur de l'alias `cargo build-appimage` (cf.
# .cargo/config.toml et xtask/) : cible le volume /target. Toute la logique
# (bootstrap tauri-cli, overlay de config, APPIMAGE_EXTRACT_AND_RUN,
# publication dans dist/ — AppImage versionnée + lien non versionné) vit dans
# xtask/src/main.rs.
set -eu

export CARGO_TARGET_DIR=/target

cd /app
cargo build-appimage

echo "== AppImage disponible dans dist/ (versionnée + fichier non versionné) =="
