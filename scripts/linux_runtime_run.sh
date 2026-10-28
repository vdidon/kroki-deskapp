#!/usr/bin/env bash
# Runs the Tauri app headless (Xvfb + manually managed dbus) and tests the
# engines through the local Kroki API. Designed to run in the container.
set -u

export CARGO_TARGET_DIR=/target
# Overridable to test another artifact, e.g. the AppImage:
#   docker run ... -e APP="/app/dist/Kroki Desk_<version>_amd64.AppImage" ...
APP="${APP:-/target/debug/kroki_deskapp}"
# AppImage without FUSE in the container: the runtime extracts itself instead
# of mounting. No effect on an ordinary binary.
export APPIMAGE_EXTRACT_AND_RUN=1

# --- Compile if needed ---
if [ ! -x "$APP" ]; then
  echo "== Binary missing, compiling (cargo build) =="
  (cd /app/src-tauri && cargo build) || { echo "!! build failed"; exit 1; }
fi

# --- Virtual display ---
echo "== Starting Xvfb =="
Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &
XVFB_PID=$!
export DISPLAY=:99
# Wait for the X socket to be ready
for i in $(seq 1 20); do
  [ -S /tmp/.X11-unix/X99 ] && break
  sleep 0.25
done

# --- D-Bus session ---
echo "== Starting D-Bus =="
eval "$(dbus-launch --sh-syntax)"
export DBUS_SESSION_BUS_ADDRESS DBUS_SESSION_BUS_PID

# WebKitGTK in a container without GPU: disable accelerated rendering, otherwise it crashes.
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export LIBGL_ALWAYS_SOFTWARE=1
export GDK_BACKEND=x11
export NO_AT_BRIDGE=1

echo "== Launching the app headless =="
"$APP" >/tmp/app.log 2>&1 &
APP_PID=$!

echo "== Waiting for the local Kroki server (127.0.0.1:8442) =="
ready=0
for i in $(seq 1 80); do
  if curl -sf -m 2 http://127.0.0.1:8442/health >/dev/null 2>&1; then
    ready=1
    echo "Server ready after ~$((i / 2))s."
    break
  fi
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "!! The app exited prematurely. Full log:"
    cat /tmp/app.log
    kill "$XVFB_PID" 2>/dev/null
    exit 1
  fi
  sleep 0.5
done

if [ "$ready" -ne 1 ]; then
  echo "!! Timeout: the server did not respond. Logs:"
  echo "--- app.log ---"; cat /tmp/app.log
  echo "--- xvfb.log ---"; cat /tmp/xvfb.log
  kill "$APP_PID" "$XVFB_PID" 2>/dev/null
  exit 1
fi

echo "== Engine tests =="
node /app/scripts/linux_runtime_test.mjs
TEST_RC=$?

echo ""
echo "== app.log (last lines) =="
tail -n 25 /tmp/app.log

kill "$APP_PID" "$XVFB_PID" 2>/dev/null
exit $TEST_RC
