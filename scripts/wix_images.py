# /// script
# requires-python = ">=3.10"
# dependencies = ["pillow"]
# ///
"""Generates the MSI installer bitmaps from the application icon.

WixUI displays its own logo by default (the red CD): in the banner of the
inner pages and on the welcome/finish pages. Tauri lets you replace them via
`wix.bannerPath` and `wix.dialogImagePath`, at fixed sizes imposed by WixUI
(493×58 and 493×312, BMP).

Re-run if the icon changes: `uv run scripts/wix_images.py`.
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICON = ROOT / "src-tauri" / "icons" / "icon.png"
OUT = ROOT / "src-tauri" / "wix"

WHITE = (255, 255, 255)
# Left panel of the welcome/finish pages: light tint of the icon's blue, against
# which its rounded corners stand out (an identical background would give away
# the icon's square).
PANEL = (233, 235, 247)


def icon(size: int) -> Image.Image:
    return Image.open(ICON).convert("RGBA").resize((size, size), Image.Resampling.LANCZOS)


def banner() -> None:
    # Banner of the inner pages: title on the left on white, WixUI reserves the
    # right for the logo (the red CD's spot).
    img = Image.new("RGB", (493, 58), WHITE)
    ico = icon(46)
    img.paste(ico, (493 - 46 - 8, 6), ico)
    img.save(OUT / "banner.bmp")


def dialog() -> None:
    # Welcome and finish pages: WixUI writes the text from x=164, the left
    # strip is free for the image.
    img = Image.new("RGB", (493, 312), WHITE)
    img.paste(PANEL, (0, 0, 164, 312))
    ico = icon(112)
    img.paste(ico, ((164 - 112) // 2, (312 - 112) // 2), ico)
    img.save(OUT / "dialog.bmp")


if __name__ == "__main__":
    banner()
    dialog()
