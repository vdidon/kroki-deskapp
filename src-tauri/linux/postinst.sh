#!/bin/sh
# postinst of the .deb package (bundle.linux.deb.postInstallScript).
#
# Refreshes the three caches the installation has just invalidated: the MIME
# database (the package drops /usr/share/mime/packages/kroki-desk.xml), the
# applications index that maps a MIME type to a .desktop, and the icon cache.
#
# Redundant in theory — shared-mime-info and desktop-file-utils set dpkg
# triggers that do this work — but those triggers only exist if the
# corresponding packages are installed, and they are merely "recommended".
# Hence the `command -v` guards: a system with neither has no MIME database to
# update anyway, and their absence must not make the installation fail. The
# `|| true` covers the same case for a tool that is present but failing: a
# cache that was not regenerated is no reason to leave the package half
# configured.
#
# It also creates the shipped-plugins folder, which only exists if one of them
# is checked in the bundling strategy: its mere presence, even empty, tells the
# application that an installer made a choice (plugins::seed_bundled) — without
# it, the application would install the plugin embedded in the binary at first
# launch.
set -e

if [ "$1" = "configure" ]; then
    mkdir -p "/usr/lib/Kroki Desk/bundled-plugins"
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
