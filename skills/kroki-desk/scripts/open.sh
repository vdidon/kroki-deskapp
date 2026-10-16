#!/usr/bin/env bash
# Opens a document in the installed Kroki Desk (.deb), at an optional reference.
#   bash open.sh "/home/…/doc.tex#eq:x"
# Output: one `STATUS: detail` line. Codes:
#   0 OPENED       opened, fragment passed
#   3 OPENED_PLAIN opened WITHOUT the fragment (version < 3.20.0) — name the passage in the reply
#   2 NOT_INSTALLED package kroki-desk not installed
#   4 NOT_FOUND    file not found
#   5 NO_DISPLAY   no graphical session (SSH, container) — nothing to show
set -u
target="${1:?usage: open.sh <path[#fragment]>}"
min_fragment="3.20.0"

# 1. The installation: the package installs /usr/bin/kroki_deskapp; the version comes from dpkg.
exe="$(command -v kroki_deskapp 2>/dev/null || true)"
[ -z "$exe" ] && [ -x /usr/bin/kroki_deskapp ] && exe=/usr/bin/kroki_deskapp
version="$(dpkg-query -W -f='${Version}' kroki-desk 2>/dev/null || true)"
if [ -z "$exe" ] || [ -z "$version" ]; then
  echo "NOT_INSTALLED: package kroki-desk not installed (sudo apt install ./kroki_deskapp-<version>-linux-x86_64-debian12.deb)"
  exit 2
fi

# 2. A window to show: the user's graphical session.
if [ -z "${DISPLAY:-}" ] && [ -z "${WAYLAND_DISPLAY:-}" ]; then
  echo "NO_DISPLAY: neither DISPLAY nor WAYLAND_DISPLAY set — headless session, nothing to open"
  exit 5
fi

# 3. The file and its fragment — same rule as the application.
file="$target"; fragment=""
if [ ! -f "$file" ] && [ "${target%#*}" != "$target" ]; then
  file="${target%#*}"; fragment="${target##*#}"
fi
if [ ! -f "$file" ]; then
  echo "NOT_FOUND: $file"
  exit 4
fi
file="$(realpath "$file")"

# 4. Detached launch: setsid -f returns immediately, whether or not the application was already open.
plain=0
if [ -n "$fragment" ] && dpkg --compare-versions "$version" lt "$min_fragment"; then plain=1; fi
arg="$file"
[ -n "$fragment" ] && [ "$plain" = 0 ] && arg="$file#$fragment"
setsid -f "$exe" "$arg" >/dev/null 2>&1
if [ "$plain" = 1 ]; then
  echo "OPENED_PLAIN: $file (Kroki Desk $version < $min_fragment, fragment '$fragment' ignored)"
  exit 3
fi
echo "OPENED: $arg (Kroki Desk $version, $exe)"
