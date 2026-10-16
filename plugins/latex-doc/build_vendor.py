#!/usr/bin/env python3
"""Regenerates `vendor/unified-latex.esm.js` — the plugin's LaTeX parser.

    python plugins/latex-doc/build_vendor.py [--keep]

Installs `@unified-latex/*` then bundles `getParser` + `printRaw` into a
standalone ESM module, in a temporary folder (nothing is written to the
repository apart from the vendor file itself). Requires `node` and `npm` on the
PATH; `esbuild` is fetched on the fly by `npx`.

The vendor file is **committed**: this script is only needed when upgrading
unified-latex. After regenerating, rerun the test suite:

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
        sys.exit(f"failed: {' '.join(cmd)} (code {proc.returncode})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--keep", action="store_true", help="keep the build folder")
    args = parser.parse_args()

    if not shutil.which("npm"):
        sys.exit("npm not found on the PATH")

    work = Path(tempfile.mkdtemp(prefix="latex-doc-vendor-"))
    print(f"building in {work}")
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
        print(f"→ {OUT} ({size / 1024:.0f} KB)")
        print("Now rerun: node tests/test_latex_plugin.mjs")
    finally:
        if args.keep:
            print(f"build folder kept: {work}")
        else:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
