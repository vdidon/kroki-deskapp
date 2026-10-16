#!/usr/bin/env bash
# Construit le paquet Debian/Ubuntu (.deb) via le bundler Tauri. Conçu pour
# tourner dans le conteneur scripts/Dockerfile.linux :
#   docker run --rm -v ${PWD}:/app -v kroki_target:/target -v kroki_cargo:/usr/local/cargo/registry \
#     kroki-linux-build bash /app/scripts/linux_deb_build.sh
#
# Simple enrobage conteneur de l'alias `cargo build-deb` (cf. .cargo/config.toml
# et xtask/) : cible le volume /target. Toute la logique (bootstrap tauri-cli,
# recopie des .kdext dans src-tauri/bundled-plugins/, overlay de config,
# publication dans dist/ — paquet versionné + fichier non versionné) vit dans
# xtask/src/main.rs.
#
# Contrairement à l'AppImage, aucun outil externe n'est téléchargé : le bundler
# assemble lui-même l'archive ar. Pas de volume ~/.cache à monter.
set -eu

export CARGO_TARGET_DIR=/target

cd /app
cargo build-deb

echo "== Paquet .deb disponible dans dist/ (versionné + fichier non versionné) =="
