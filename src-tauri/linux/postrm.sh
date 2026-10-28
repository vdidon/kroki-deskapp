#!/bin/sh
# postrm of the .deb package (bundle.linux.deb.postRemoveScript).
#
# Mirror of the postinst: the files have just been removed, so the same caches
# still point to a .desktop and MIME types that no longer exist. Without this
# pass, Kroki Desk would stay offered in "Open with" (« Ouvrir avec ») until the
# next package that triggers a rebuild.
#
# Nothing is purged beyond that: plugins, settings and sessions live in each
# user's profile (~/.config/kroki-deskapp), out of reach of a per-machine
# package — leaving them there is what allows reinstalling without losing
# anything again.
#
# The only cleanup in /usr/lib: the bundled-plugins folder created by the
# postinst, which dpkg ignores when no package file lives in it — then its
# parent, which dpkg left behind because it could not empty it. rmdir only
# removes empty directories.
set -e

if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
    rmdir "/usr/lib/Kroki Desk/bundled-plugins" "/usr/lib/Kroki Desk" 2>/dev/null || true
    if command -v update-mime-database >/dev/null 2>&1; then
        update-mime-database /usr/share/mime || true
    fi
    if command -v update-desktop-database >/dev/null 2>&1; then
        update-desktop-database -q /usr/share/applications || true
    fi
    if command -v gtk-update-icon-cache >/dev/null 2>&1; then
        gtk-update-icon-cache -q -t -f /usr/share/icons/hicolor || true
    fi
fi

exit 0
