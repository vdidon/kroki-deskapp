#!/bin/sh
# postrm du paquet .deb (bundle.linux.deb.postRemoveScript).
#
# Symétrique du postinst : les fichiers viennent d'être retirés, les mêmes caches
# désignent donc encore un .desktop et des types MIME qui n'existent plus. Sans ce
# passage, Kroki Desk resterait proposé dans « Ouvrir avec » jusqu'au prochain
# paquet qui déclenche la reconstruction.
#
# Rien n'est purgé au-delà : les plugins, réglages et sessions vivent dans le
# profil de chaque utilisateur (~/.config/kroki-deskapp), hors de portée d'un
# paquet installé par machine — les y laisser est ce qui permet de réinstaller
# sans rien reperdre.
#
# Seul nettoyage dans /usr/lib : le dossier bundled-plugins créé par le postinst,
# que dpkg ignore quand aucun fichier du paquet n'y vit — puis son parent, que
# dpkg a laissé faute de pouvoir le vider. rmdir ne retire que du vide.
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
