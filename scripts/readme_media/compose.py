"""Compose les médias du README à partir des captures brutes (Pillow)."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops

MEDIA = Path(__file__).resolve().parents[2] / "doc" / "media"
RAW = Path(__file__).resolve().parent / "raw"
FONT = "C:/Windows/Fonts/segoeui.ttf"
FONT_B = "C:/Windows/Fonts/segoeuib.ttf"


def strip_rules(im):
    """Blanchit les filets horizontaux gris clair (séparateur de la vue) captés avec le SVG."""
    import numpy as np
    a = np.array(im.convert("RGB")).astype(int)
    lum = a.mean(axis=2)
    for y in range(max(8, a.shape[0] // 12)):  # le filet est toujours en tête
        row = lum[y]
        grey = (row > 200) & (row < 250)
        if grey.mean() > 0.85:
            a[y][grey] = 255
    return Image.fromarray(a.astype("uint8")).convert("RGBA")


def trim(im, bg=(255, 255, 255)):
    rgb = strip_rules(im).convert("RGB")
    diff = ImageChops.difference(rgb, Image.new("RGB", rgb.size, bg))
    diff = diff.point(lambda v: 255 if v > 12 else 0)
    box = diff.getbbox()
    return Image.fromarray(__import__('numpy').array(rgb)).convert('RGBA').crop(box) if box else im


def framed(src, dst, radius=22, shadow=40, title=None):
    """Fenêtre arrondie + ombre douce sur fond transparent."""
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius, fill=255)
    win = Image.new("RGBA", (w, h))
    win.paste(im, (0, 0), mask)
    border = ImageDraw.Draw(win)
    border.rounded_rectangle((0, 0, w - 1, h - 1), radius, outline=(0, 0, 0, 60), width=2)
    W, H = w + 2 * shadow, h + 2 * shadow
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sh = Image.new("L", (W, H), 0)
    ImageDraw.Draw(sh).rounded_rectangle((shadow, shadow + 10, shadow + w, shadow + h + 10), radius, fill=90)
    sh = sh.filter(ImageFilter.GaussianBlur(shadow / 2.2))
    out.paste(Image.new("RGBA", (W, H), (0, 0, 0, 255)), (0, 0), sh)
    out.alpha_composite(win, (shadow, shadow))
    out.save(dst, optimize=True)


def gallery(dst, cols=3, cell=(640, 420), gap=28, margin=40):
    names = {
        "mermaid": "Mermaid", "plantuml": "PlantUML", "graphviz": "Graphviz", "d2": "D2",
        "bpmn": "BPMN", "vegalite": "Vega-Lite", "c4plantuml": "C4 (PlantUML)", "dbml": "DBML",
        "wavedrom": "WaveDrom", "svgbob": "Svgbob", "tikz": "TikZ", "excalidraw": "Excalidraw",
    }
    tiles = sorted(RAW.glob("raw-tile-*.png"))
    rows = (len(tiles) + cols - 1) // cols
    cw, ch = cell
    label_h = 56
    W = margin * 2 + cols * cw + (cols - 1) * gap
    H = margin * 2 + rows * (ch + label_h) + (rows - 1) * gap
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(out)
    f = ImageFont.truetype(FONT_B, 30)
    for i, t in enumerate(tiles):
        kind = t.stem.split("-", 3)[3]
        r, c = divmod(i, cols)
        x0 = margin + c * (cw + gap)
        y0 = margin + r * (ch + label_h + gap)
        d.rounded_rectangle((x0, y0, x0 + cw, y0 + ch + label_h), 18, fill=(255, 255, 255, 255), outline=(208, 215, 222, 255), width=2)
        im = trim(Image.open(t).convert("RGBA"))
        pad = 28
        im.thumbnail((cw - 2 * pad, ch - 2 * pad), Image.LANCZOS)
        out.alpha_composite(im, (x0 + (cw - im.width) // 2, y0 + (ch - im.height) // 2))
        d.line((x0 + 2, y0 + ch, x0 + cw - 2, y0 + ch), fill=(234, 238, 242, 255), width=2)
        label = names.get(kind, kind)
        tw = d.textlength(label, font=f)
        d.text((x0 + (cw - tw) / 2, y0 + ch + 8), label, font=f, fill=(36, 41, 47, 255))
    out.save(dst, optimize=True)


if __name__ == "__main__":
    what = sys.argv[1]
    if what == "hero":
        for mode in ("light", "dark"):
            framed(RAW / f"raw-hero-{mode}.png", MEDIA / f"hero-{mode}.png")
    elif what == "gallery":
        gallery(MEDIA / "engines.png")
    elif what == "frame":
        framed(Path(sys.argv[2]), Path(sys.argv[3]))
