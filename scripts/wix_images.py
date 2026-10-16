# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
"""Génère les bitmaps de l'installeur MSI à partir de l'icône de l'application.

WixUI affiche par défaut son propre logo (le CD rouge) : dans le bandeau des
pages intérieures et sur les pages d'accueil/de fin. Tauri permet de les
remplacer par `wix.bannerPath` et `wix.dialogImagePath`, à des tailles fixes
imposées par WixUI (493×58 et 493×312, BMP).

À relancer si l'icône change : `uv run scripts/wix_images.py`.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICON = ROOT / "src-tauri" / "icons" / "icon.png"
OUT = ROOT / "src-tauri" / "wix"

WHITE = (255, 255, 255)
# Panneau gauche des pages d'accueil/de fin : teinte claire du bleu de l'icône,
# sur laquelle ses coins arrondis se détachent (un fond identique laisserait
# deviner le carré de l'icône).
PANEL = (233, 235, 247)


def icon(size: int) -> Image.Image:
    return Image.open(ICON).convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)


def banner() -> None:
    # Bandeau des pages intérieures : titre à gauche sur blanc, WixUI réserve
    # la droite au logo (emplacement du CD rouge).
    img = Image.new("RGB", (493, 58), WHITE)
    ico = icon(46)
    img.paste(ico, (493 - 46 - 8, 6), ico)
    img.save(OUT / "banner.bmp")


def dialog() -> None:
    # Pages d'accueil et de fin : WixUI écrit le texte à partir de x=164,
    # la bande de gauche est libre pour l'image.
    img = Image.new("RGB", (493, 312), WHITE)
    img.paste(PANEL, (0, 0, 164, 312))
    ico = icon(112)
    img.paste(ico, ((164 - 112) // 2, (312 - 112) // 2), ico)
    img.save(OUT / "dialog.bmp")


if __name__ == "__main__":
    banner()
    dialog()
