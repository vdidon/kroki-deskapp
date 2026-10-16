#!/usr/bin/env python3
"""Régénère `vendor/unified-latex.esm.js` — le parseur LaTeX du plugin.

    python plugins/latex-doc/build_vendor.py [--keep]

Installe `@unified-latex/*` puis bundle `getParser` + `printRaw` en un module
ESM autonome, dans un dossier temporaire (rien n'est écrit dans le dépôt hors
le vendor lui-même). Requiert `node` et `npm` dans le PATH ; `esbuild` est
récupéré à la volée par `npx`.

Le vendor est **committé** : ce script ne sert qu'aux montées de version
d'unified-latex. Après régénération, relancer la suite de tests :

    node tests/test_latex_plugin.mjs
"""

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

PACKAGES = [
    "@unified-latex/unified-latex-util-parse",
    "@unified-latex/unified-latex-util-print-raw",
]

ENTRY = """\
export { getParser } from "@unified-latex/unified-latex-util-parse";
export { printRaw } from "@unified-latex/unified-latex-util-print-raw";
"""

OUT = Path(__file__).resolve().parent / "vendor" / "unified-latex.esm.js"


def run(cmd: list[str], cwd: Path) -> None:
    print("  $", " ".join(cmd))
    proc = subprocess.run(cmd, cwd=cwd, shell=sys.platform == "win32")
    if proc.returncode:
        sys.exit(f"échec : {' '.join(cmd)} (code {proc.returncode})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--keep", action="store_true", help="conserver le dossier de build")
    args = parser.parse_args()

    if not shutil.which("npm"):
        sys.exit("npm introuvable dans le PATH")

    work = Path(tempfile.mkdtemp(prefix="latex-doc-vendor-"))
    print(f"build dans {work}")
    try:
        (work / "package.json").write_text('{"type":"module","private":true}\n', encoding="utf-8")
        (work / "entry.mjs").write_text(ENTRY, encoding="utf-8")
        run(["npm", "install", "--no-audit", "--no-fund", *PACKAGES], work)
        OUT.parent.mkdir(parents=True, exist_ok=True)
        run(
            [
                "npx", "esbuild", "entry.mjs",
                "--bundle", "--format=esm", "--minify",
                "--legal-comments=none",
                f"--outfile={OUT}",
            ],
            work,
        )
        size = OUT.stat().st_size
        print(f"→ {OUT} ({size / 1024:.0f} Ko)")
        print("Relancer maintenant : node tests/test_latex_plugin.mjs")
    finally:
        if args.keep:
            print(f"dossier de build conservé : {work}")
        else:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
