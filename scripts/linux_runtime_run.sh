#!/usr/bin/env bash
# Lance l'app Tauri en headless (Xvfb + dbus géré manuellement) et teste les
# moteurs via l'API Kroki locale. Conçu pour tourner dans le conteneur.
set -u

export CARGO_TARGET_DIR=/target
# Surchargable pour tester un autre artefact, p. ex. l'AppImage :
#   docker run ... -e APP="/app/dist/Kroki Desk_<version>_amd64.AppImage" ...
APP="${APP:-/target/debug/kroki_deskapp}"
# AppImage sans FUSE dans le conteneur : le runtime s'extrait au lieu de se
# monter. Sans effet sur un binaire ordinaire.
export APPIMAGE_EXTRACT_AND_RUN=1

# --- Compilation si nécessaire ---
if [ ! -x "$APP" ]; then
  echo "== Binaire absent, compilation (cargo build) =="
  (cd /app/src-tauri && cargo build) || { echo "!! échec de compilation"; exit 1; }
fi

# --- Display virtuel ---
echo "== Démarrage de Xvfb =="
Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
XVFB_PID=$!
export DISPLAY=:99
# Attendre que le socket X soit prêt
for i in $(seq 1 20); do
  [ -S /tmp/.X11-unix/X99 ] && break
  sleep 0.25
done

# --- Session D-Bus ---
echo "== Démarrage de D-Bus =="
eval "$(dbus-launch --sh-syntax)"
export DBUS_SESSION_BUS_ADDRESS DBUS_SESSION_BUS_PID

# WebKitGTK en conteneur sans GPU : désactiver le rendu accéléré sinon crash.
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export LIBGL_ALWAYS_SOFTWARE=1
export GDK_BACKEND=x11
export NO_AT_BRIDGE=1

echo "== Lancement de l'app en headless =="
"$APP" >/tmp/app.log 2>&1 &
APP_PID=$!

echo "== Attente du serveur Kroki local (127.0.0.1:8442) =="
ready=0
for i in $(seq 1 80); do
  if curl -sf -m 2 http://127.0.0.1:8442/health >/dev/null 2>&1; then
    ready=1
    echo "Serveur prêt après ~$((i / 2))s."
    break
  fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "!! L'app s'est arrêtée prématurément. Log complet :"
    cat /tmp/app.log
    kill "$XVFB_PID" 2>/dev/null
    exit 1
  fi
  sleep 0.5
done

if [ "$ready" -ne 1 ]; then
  echo "!! Timeout : le serveur n'a pas répondu. Logs :"
  echo "--- app.log ---"; cat /tmp/app.log
  echo "--- xvfb.log ---"; cat /tmp/xvfb.log
  kill "$APP_PID" "$XVFB_PID" 2>/dev/null
  exit 1
fi

echo "== Test des moteurs =="
node /app/scripts/linux_runtime_test.mjs
TEST_RC=$?

echo ""
echo "== app.log (dernières lignes) =="
tail -n 25 /tmp/app.log

kill "$APP_PID" "$XVFB_PID" 2>/dev/null
exit $TEST_RC
