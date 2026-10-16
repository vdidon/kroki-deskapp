#!/bin/sh
# postinst du paquet .deb (bundle.linux.deb.postInstallScript).
#
# Rafraîchit les trois caches que l'installation vient d'invalider : la base MIME
# (le paquet dépose /usr/share/mime/packages/kroki-desk.xml), l'index des
# applications qui associe un type MIME à un .desktop, et le cache d'icônes.
#
# Redondant en théorie — shared-mime-info et desktop-file-utils posent des
# déclencheurs dpkg qui font ce travail — mais ces déclencheurs n'existent que si
# les paquets correspondants sont installés, et ils ne sont que « recommandés ».
# D'où les gardes `command -v` : sur un système qui n'a ni l'un ni l'autre, il n'y
# a de toute façon pas de base MIME à mettre à jour, et l'absence ne doit pas
# faire échouer l'installation. Le `|| true` couvre le même cas de figure pour un
# outil présent mais en échec : un cache non régénéré ne justifie pas de laisser
# le paquet à demi configuré.
set -e

if [ "$1" = "configure" ]; then
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
