#!/usr/bin/env python3
"""Regenerates `ui/third-party-notices.txt` — the license notices of everything
the application ships that it did not write. The file lives in `ui/` so that it
is embedded in the binary with the other assets (compressed by Tauri) and shown
by the « Third-party licenses » dialog (`ui/js/notices.js`).

    uv run scripts/third_party_notices.py [--keep] [--offline-cargo]

Three sources, each read from what is actually distributed:

- **Rust crates**: the normal-dependency closure of `src-tauri` for the Windows
  and Linux targets (`cargo metadata --filter-platform`; build and dev
  dependencies are not shipped). License texts are read from the crate sources
  in the cargo registry.
- **JavaScript vendors** (`ui/vendor`, `ui/renderer/vendor`, the `latex-doc`
  bundle): `NPM` below pins each package to the version that was vendored. Each
  one is installed in its own temporary folder (`--ignore-scripts`: nothing from
  the registry runs) and its whole production dependency tree is listed — the
  vendored files are bundles, their dependencies are inside them.
- **Everything else** (`EXTRAS`): the embedded jars, whose license files are
  read from the jar itself, and code compiled into a bundle that npm cannot see
  (Go runtime in d2, Graphviz in its WASM, ClojureScript in bytefield-svg).

When a component carries no license file, the text comes from the SPDX license
list (downloaded, cached in the temporary folder) with its copyright line
filled in from the package metadata.

To re-run after: a crate update (`Cargo.lock`), a vendor update (bump its
version in `NPM`), a new vendor or a new embedded asset. Requires `cargo`,
`node`/`npm` and network access.
"""

import argparse
import json
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "ui" / "third-party-notices.txt"
TARGETS = ["x86_64-pc-windows-msvc", "x86_64-unknown-linux-gnu"]

# (package, version vendored, files of the repository it ends up in)
NPM = [
    ("markdown-it", "14.2.0", "ui/vendor/markdown-it.min.js"),
    ("highlight.js", "11.11.1", "ui/vendor/highlight.min.js, ui/vendor/hljs-github*.min.css"),
    ("github-markdown-css", "5.9.0", "ui/vendor/github-markdown.min.css"),
    ("dompurify", "3.4.8", "ui/vendor/purify.min.js"),
    ("katex", "0.16.11", "ui/vendor/katex/ (script, CSS, fonts)"),
    ("markdown-it-texmath", "1.0.0", "ui/vendor/katex/texmath.js"),
    ("plotly.js", "3.6.0", "ui/vendor/plotly.min.js"),
    ("mermaid", "11.15.0", "ui/renderer/vendor/mermaid.min.js"),
    ("@hpcc-js/wasm-graphviz", "1.22.0", "ui/renderer/vendor/graphviz.es.js"),
    ("@terrastruct/d2", "0.1.33", "ui/renderer/vendor/d2.esm.js"),
    ("bpmn-js", "18.18.0", "ui/renderer/vendor/bpmn-viewer.min.js"),
    ("@excalidraw/excalidraw", "0.18.1", "ui/renderer/vendor/excalidraw.esm.js"),
    ("@softwaretechnik/dbml-renderer", "1.0.31", "ui/renderer/vendor/dbml.js"),
    ("vega", "5.33.1", "ui/renderer/vendor/vega.min.js"),
    ("vega-lite", "5.23.0", "ui/renderer/vendor/vega-lite.min.js"),
    ("vega-interpreter", "1.2.1", "ui/renderer/vendor/vega-interpreter.min.js"),
    ("nomnoml", "1.7.0", "ui/renderer/vendor/nomnoml.js"),
    ("graphre", "0.1.3", "ui/renderer/vendor/graphre.js"),
    ("wavedrom", "3.6.1", "ui/renderer/vendor/wavedrom*.js"),
    ("bytefield-svg", "1.11.0", "ui/renderer/vendor/bytefield-svg.js"),
    ("@unified-latex/unified-latex-util-parse", "1.8.4", "plugins/latex-doc/vendor/unified-latex.esm.js"),
    ("@unified-latex/unified-latex-util-print-raw", "1.8.4", "plugins/latex-doc/vendor/unified-latex.esm.js"),
]

PLANTUML_CREDITS = """\
PlantUML is free software; you can redistribute it and/or modify it under the
terms of the MIT License. Credits listed by PlantUML itself:
  Icons provided by OpenIconic: https://useiconic.com/open
  Archimate sprites provided by Archi: http://www.archimatetool.com
  Stdlib AWS provided by https://github.com/milo-minderbinder/AWS-PlantUML
  Stdlib Icons provided by https://github.com/tupadr3/plantuml-icon-font-sprites
  ASCIIMathML (c) Peter Jipsen http://www.chapman.edu/~jipsen
  ASCIIMathML (c) David Lippman http://www.pierce.ctc.edu/dlippman
  CafeUndZopfli ported by Eugene Klyuchnikov https://github.com/eustas/CafeUndZopfli
  Brotli (c) by the Brotli Authors https://github.com/google/brotli
  Themes (c) by Brett Schwarz https://github.com/bschwarz/puml-themes
  Twemoji (c) by Twitter at https://twemoji.twitter.com/ (graphics: CC-BY 4.0)
"""

# name, version, SPDX expression, copyright line, source URL, shipped as,
# jar to read license files from, extra text
EXTRAS = [
    dict(
        name="PlantUML (MIT edition)", version="1.2026.6", license="MIT",
        copyright="Copyright (C) 2009-2024, Arnaud Roques",
        url="https://github.com/plantuml/plantuml-mit",
        files="src-tauri/assets/plantuml-mit.jar", extra=PLANTUML_CREDITS,
    ),
    dict(
        name="ditaa", version="0.11.0", license="LGPL-3.0-or-later",
        url="https://github.com/stathissideris/ditaa/tree/v0.11.0",
        files="src-tauri/assets/ditaa-0.11.0-standalone.jar",
        jar="src-tauri/assets/ditaa-0.11.0-standalone.jar",
        # The LGPL v3 is a set of additional permissions on top of the GPL v3:
        # its text is not complete without the GPL's.
        also_spdx=["GPL-3.0-only"],
        extra="Bundles Apache Batik, Apache Commons IO and Apache XML Commons "
              "(Apache-2.0, with the W3C/SAX notices); their license and NOTICE "
              "files follow, as shipped inside the jar.\n",
    ),
    dict(
        name="Graphviz (compiled to WebAssembly in @hpcc-js/wasm-graphviz)",
        version="", license="EPL-1.0",
        copyright="Copyright (c) AT&T Corp. and the Graphviz contributors",
        url="https://gitlab.com/graphviz/graphviz",
        files="ui/renderer/vendor/graphviz.es.js",
    ),
    dict(
        name="Go runtime and standard library (compiled to WebAssembly in d2)",
        version="", license="BSD-3-Clause",
        copyright="Copyright 2009 The Go Authors.",
        url="https://go.googlesource.com/go",
        files="ui/renderer/vendor/d2.esm.js",
    ),
    dict(
        name="ClojureScript (compiled into bytefield-svg)", version="",
        license="EPL-1.0", copyright="Copyright (c) Rich Hickey. All rights reserved.",
        url="https://github.com/clojure/clojurescript",
        files="ui/renderer/vendor/bytefield-svg.js",
    ),
    dict(
        name="Closure Library (compiled into bytefield-svg)", version="",
        license="Apache-2.0", copyright="Copyright The Closure Library Authors.",
        url="https://github.com/google/closure-library",
        files="ui/renderer/vendor/bytefield-svg.js",
    ),
]

# Choice among the alternatives of an `OR`: the first one listed wins.
PREFERENCE = [
    "MIT", "Apache-2.0", "BSD-3-Clause", "BSD-2-Clause", "ISC", "Zlib", "0BSD",
    "MIT-0", "Unlicense", "CC0-1.0", "BSL-1.0", "Unicode-3.0", "Unicode-DFS-2016",
    "Apache-2.0 WITH LLVM-exception", "MPL-2.0",
]
# Licenses whose terms require the source to be made available: listed apart.
SOURCE_OBLIGATION = ("MPL-", "EPL-", "LGPL-", "GPL-")
SPDX_URL = "https://raw.githubusercontent.com/spdx/license-list-data/main/text/{}.txt"

LICENSE_FILE = re.compile(r"^(licen[cs]e|copying|unlicense|copyright|notice)", re.I)
# Signature of each license in a file: (SPDX id, regexes that must all match).
SIGNATURES = [
    ("MIT", [r"Permission is hereby granted, free of charge"]),
    ("Apache-2.0", [r"Apache License", r"Version 2\.0"]),
    ("BSD-3-Clause", [r"Redistribution and use", r"(Neither the name|names of its\s+contributors)"]),
    ("BSD-2-Clause", [r"Redistribution and use in source and binary forms"]),
    ("ISC", [r"Permission to use, copy, modify, and(/or)? distribute this software"]),
    ("0BSD", [r"Permission to use, copy, modify, and(/or)? distribute this software"]),
    ("Zlib", [r"provided 'as-is'", r"altered source versions must be plainly marked"]),
    ("Unlicense", [r"This is free and unencumbered software released into the public domain"]),
    ("MPL-2.0", [r"Mozilla Public License", r"2\.0"]),
    ("Unicode-3.0", [r"UNICODE LICENSE V3"]),
    ("Unicode-DFS-2016", [r"UNICODE, INC\. LICENSE AGREEMENT"]),
    ("CC0-1.0", [r"(CC0|Creative Commons Legal Code)"]),
    ("BSL-1.0", [r"Boost Software License"]),
    ("EPL-2.0", [r"Eclipse Public License", r"2\.0"]),
    ("EPL-1.0", [r"Eclipse Public License", r"v ?1\.0"]),
    ("LGPL-3.0", [r"GNU LESSER GENERAL PUBLIC LICENSE", r"Version 3"]),
    ("bzip2-1.0.6", [r"bzip2", r"Julian"]),
]

MIT_BODY = """\
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
"""


@dataclass
class Component:
    kind: str  # "Rust crate", "npm package", "embedded"
    name: str
    version: str
    license: str  # SPDX expression as declared
    url: str
    shipped: str = ""
    texts: list[str] = field(default_factory=list)  # license texts that apply
    synthesized: bool = False  # no license file: text built from SPDX

    @property
    def label(self) -> str:
        return f"{self.name} {self.version}".strip()


# ---------------------------------------------------------------- licenses


def parse_expr(expr: str):
    """SPDX expression → tree: ("leaf", id) | ("and"|"or", [children])."""
    expr = expr.replace("/", " OR ")
    tokens = re.findall(r"\(|\)|[^\s()]+", expr)
    pos = 0

    def peek():
        return tokens[pos] if pos < len(tokens) else None

    def take():
        nonlocal pos
        pos += 1
        return tokens[pos - 1]

    def primary():
        if peek() == "(":
            take()
            node = or_expr()
            take()  # ")"
            return node
        ident = take()
        if peek() == "WITH":
            take()
            ident = f"{ident} WITH {take()}"
        return ("leaf", ident)

    def and_expr():
        items = [primary()]
        while peek() == "AND":
            take()
            items.append(primary())
        return items[0] if len(items) == 1 else ("and", items)

    def or_expr():
        items = [and_expr()]
        while peek() == "OR":
            take()
            items.append(and_expr())
        return items[0] if len(items) == 1 else ("or", items)

    return or_expr()


def rank(ident: str) -> int:
    return PREFERENCE.index(ident) if ident in PREFERENCE else len(PREFERENCE)


def choose(node) -> list[str]:
    """Licenses to comply with: every branch of an AND, the preferred one of an OR."""
    kind, value = node
    if kind == "leaf":
        return [value]
    if kind == "and":
        return [ident for child in value for ident in choose(child)]
    return min((choose(child) for child in value), key=lambda ids: max(map(rank, ids)))


def detect(text: str) -> set[str]:
    return {
        ident for ident, patterns in SIGNATURES
        if all(re.search(p, text, re.I) for p in patterns)
    }


def base_id(ident: str) -> str:
    """`Apache-2.0 WITH LLVM-exception` → `Apache-2.0`, `LGPL-3.0-or-later` → `LGPL-3.0`."""
    ident = ident.split(" WITH ")[0]
    return re.sub(r"-(only|or-later)$|\+$", "", ident)


def read_text(path: Path) -> str:
    return path.read_bytes().decode("utf-8", errors="replace").replace("\r\n", "\n").strip() + "\n"


def license_files(directory: Path) -> list[Path]:
    return sorted(
        p for p in directory.iterdir()
        if p.is_file() and LICENSE_FILE.match(p.name) and p.suffix.lower() not in (".rs", ".js", ".json", ".ts")
    )


class Spdx:
    """SPDX license texts, downloaded once."""

    def __init__(self, cache: Path):
        self.cache = cache
        cache.mkdir(parents=True, exist_ok=True)

    def text(self, ident: str) -> str:
        ident = ident.split(" WITH ")[0]
        cached = self.cache / f"{ident}.txt"
        if not cached.exists():
            with urllib.request.urlopen(SPDX_URL.format(ident), timeout=30) as resp:
                cached.write_bytes(resp.read())
        return read_text(cached)

    def filled(self, ident: str, copyright_line: str) -> str:
        """SPDX text with its placeholder copyright line replaced."""
        if base_id(ident) == "MIT":
            return f"{copyright_line}\n\n{MIT_BODY}"
        text = self.text(ident)
        lines = text.splitlines()
        for i, line in enumerate(lines):
            if re.search(r"<(year|owner|copyright holders?)>", line, re.I):
                lines[i] = copyright_line
                return "\n".join(lines) + "\n"
        return f"{copyright_line}\n\n{text}" if copyright_line else text


def resolve_texts(comp: Component, directory: Path | None, authors: str, spdx: Spdx) -> None:
    """Fills `comp.texts`: for each license to comply with, the file of the
    package that carries it, else the SPDX text with the package's copyright."""
    files = license_files(directory) if directory and directory.is_dir() else []
    contents = {p: read_text(p) for p in files}
    wanted = choose(parse_expr(comp.license)) if comp.license else []
    taken: list[Path] = []
    for ident in wanted:
        base = base_id(ident)
        hint = base.split("-")[0].lower()
        match = [p for p, t in contents.items() if base in detect(t)]
        # A dual-licensed crate's LICENSE-APACHE / LICENSE-MIT: the name decides.
        by_name = [p for p in match if hint in p.name.lower()]
        if not match:
            by_name = [p for p in contents if hint in p.name.lower() and "notice" not in p.name.lower()]
        pick = (by_name or match)[:1]
        if pick:
            if pick[0] not in taken:
                taken.append(pick[0])
        else:
            holder = authors or f"the {comp.name} authors"
            comp.texts.append(spdx.filled(ident, f"Copyright (c) {holder}"))
            comp.synthesized = True
    # Apache-2.0 section 4(d): NOTICE files travel with the work.
    if any(base_id(i) == "Apache-2.0" for i in wanted):
        taken += [p for p in contents if p.name.lower().startswith("notice") and p not in taken]
    comp.texts = [contents[p] for p in taken] + comp.texts
    if not wanted and contents:  # no declared license: keep what is there
        comp.texts = list(contents.values())


# ------------------------------------------------------------------ sources


def run(cmd: list[str], cwd: Path) -> str:
    proc = subprocess.run(
        cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8",
        shell=sys.platform == "win32",
    )
    if proc.returncode:
        sys.exit(f"failed: {' '.join(cmd)}\n{proc.stderr}")
    return proc.stdout


def rust_crates(spdx: Spdx, offline: bool) -> list[Component]:
    crates: dict[tuple[str, str], Component] = {}
    for target in TARGETS:
        cmd = ["cargo", "metadata", "--format-version", "1", "--locked",
               "--manifest-path", str(ROOT / "src-tauri" / "Cargo.toml"),
               "--filter-platform", target]
        meta = json.loads(run(cmd + (["--offline"] if offline else []), ROOT))
        packages = {p["id"]: p for p in meta["packages"]}
        nodes = {n["id"]: n for n in meta["resolve"]["nodes"]}
        root = meta["resolve"]["root"]
        seen, stack = set(), [root]
        while stack:
            node = stack.pop()
            if node in seen:
                continue
            seen.add(node)
            stack += [
                d["pkg"] for d in nodes[node]["deps"]
                if any(k["kind"] is None for k in d["dep_kinds"])
            ]
        for ident in seen - {root}:
            p = packages[ident]
            key = (p["name"], p["version"])
            if key in crates:
                continue
            comp = Component(
                "Rust crate", p["name"], p["version"], p["license"] or "",
                p["repository"] or f"https://crates.io/crates/{p['name']}/{p['version']}",
            )
            directory = Path(p["manifest_path"]).parent
            if not comp.license and p["license_file"]:
                comp.texts.append(read_text(directory / p["license_file"]))
            else:
                authors = ", ".join(re.sub(r"\s*<[^>]*>", "", a) for a in p["authors"])
                resolve_texts(comp, directory, authors, spdx)
            crates[key] = comp
    return sorted(crates.values(), key=lambda c: (c.name.lower(), c.version))


def npm_packages(work: Path, spdx: Spdx) -> list[Component]:
    packages: dict[tuple[str, str], Component] = {}
    for name, version, shipped in NPM:
        folder = work / re.sub(r"[^\w.-]", "_", name)
        folder.mkdir(parents=True)
        (folder / "package.json").write_text('{"private":true}\n', encoding="utf-8", newline="\n")
        print(f"  npm install {name}@{version}")
        run(["npm", "install", "--ignore-scripts", "--omit=dev", "--no-audit",
             "--no-fund", "--loglevel=error", f"{name}@{version}"], folder)
        lock = json.loads((folder / "node_modules" / ".package-lock.json").read_text(encoding="utf-8"))
        for path, entry in lock["packages"].items():
            if not path or entry.get("dev") or entry.get("link"):
                continue
            directory = folder / path
            manifest = json.loads((directory / "package.json").read_text(encoding="utf-8"))
            key = (manifest["name"], manifest["version"])
            top = manifest["name"] == name
            if key in packages:
                if top:
                    packages[key].shipped = shipped
                continue
            license = manifest.get("license") or ""
            if isinstance(license, dict):
                license = license.get("type", "")
            if not license and isinstance(manifest.get("licenses"), list):
                license = " OR ".join(l.get("type", "") for l in manifest["licenses"])
            repo = manifest.get("repository") or ""
            if isinstance(repo, dict):
                repo = repo.get("url", "")
            repo = re.sub(r"^git\+|\.git$", "", repo).replace("git://", "https://")
            if repo and not repo.startswith("http"):
                repo = f"https://github.com/{repo.removeprefix('github:')}"
            author = manifest.get("author") or ""
            if isinstance(author, dict):
                author = author.get("name", "")
            author = re.sub(r"\s*[<(][^>)]*[>)]", "", author)
            comp = Component(
                "npm package", manifest["name"], manifest["version"],
                "" if license.startswith("SEE LICENSE") else license,
                repo or f"https://www.npmjs.com/package/{manifest['name']}/v/{manifest['version']}",
                shipped if top else "",
            )
            resolve_texts(comp, directory, author, spdx)
            if not comp.license:
                comp.license = "see license text"
            packages[key] = comp
    return sorted(packages.values(), key=lambda c: (c.name.lower(), c.version))


def extras(spdx: Spdx) -> list[Component]:
    out = []
    for e in EXTRAS:
        comp = Component("embedded", e["name"], e["version"], e["license"], e["url"], e["files"])
        if "jar" in e:
            with zipfile.ZipFile(ROOT / e["jar"]) as jar:
                for entry in sorted(jar.namelist()):
                    leaf = entry.rsplit("/", 1)[-1]
                    if leaf and LICENSE_FILE.match(leaf) and not entry.endswith(".class"):
                        body = jar.read(entry).decode("utf-8", errors="replace").replace("\r\n", "\n").strip()
                        comp.texts.append(f"[{entry}]\n{body}\n")
        else:
            for ident in choose(parse_expr(e["license"])):
                comp.texts.append(spdx.filled(ident, e.get("copyright", "")))
        for ident in e.get("also_spdx", []):
            comp.texts.append(spdx.text(ident))
        if e.get("extra"):
            comp.texts.insert(0, e["extra"])
        out.append(comp)
    return out


# ------------------------------------------------------------------- output


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def render(groups: list[tuple[str, list[Component]]]) -> str:
    out = [
        "THIRD-PARTY NOTICES — Kroki Desk",
        "",
        "Kroki Desk is distributed under the MIT License (see LICENSE). It includes",
        "the third-party software listed below, each under its own license. Where a",
        "component offers a choice of licenses, the one it is used under is the one",
        "whose text is reproduced here.",
        "",
        "The vendored bundles are listed with the version they were built from;",
        "their dependencies with the version npm resolves for it today, which can",
        "differ in patch level from the one inside the bundle. A package listed",
        "here may also be one that the bundle does not end up using.",
        "",
        "Generated by scripts/third_party_notices.py — do not edit by hand.",
        "",
    ]
    everything = [c for _, comps in groups for c in comps]

    with_source = [c for c in everything if any(base_id(i).startswith(SOURCE_OBLIGATION)
                                                for i in choose(parse_expr(c.license or "x")))]
    if with_source:
        out += [
            "SOURCE CODE",
            "===========",
            "",
            "The following components are distributed under licenses that require",
            "their source code to be made available (MPL, EPL, LGPL). Kroki Desk",
            "uses them unmodified; their complete corresponding source is available",
            "at the address given for each:",
            "",
        ]
        out += [f"  {c.label} ({c.license}): {c.url}" for c in with_source]
        out.append("")

    out += ["COMPONENTS", "==========", ""]
    for title, comps in groups:
        out += [f"{title} ({len(comps)})", "-" * (len(title) + len(str(len(comps))) + 3)]
        for c in comps:
            line = f"  {c.label} — {c.license}"
            if c.shipped:
                line += f" — {c.shipped}"
            out += [line, f"      {c.url}"]
        out.append("")

    out += ["LICENSE TEXTS", "=============", ""]
    by_text: dict[str, tuple[str, list[str]]] = {}
    for c in everything:
        for text in c.texts:
            key = normalize(text)
            by_text.setdefault(key, (text, []))[1].append(c.label)
    for n, (text, labels) in enumerate(by_text.values(), 1):
        out += ["-" * 79, f"[{n}] Applies to: " + ", ".join(dict.fromkeys(labels)), "-" * 79, "", text.rstrip(), ""]
    return "\n".join(out).rstrip() + "\n"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--keep", action="store_true", help="keep the temporary folder")
    parser.add_argument("--offline-cargo", action="store_true", help="cargo metadata --offline")
    args = parser.parse_args()
    for tool in ("cargo", "npm"):
        if not shutil.which(tool):
            sys.exit(f"{tool} not found on the PATH")

    work = Path(tempfile.mkdtemp(prefix="kd-notices-"))
    print(f"working in {work}")
    try:
        spdx = Spdx(work / "spdx")
        print("Rust crates…")
        crates = rust_crates(spdx, args.offline_cargo)
        print("npm packages…")
        npm = npm_packages(work / "npm", spdx)
        groups = [
            ("Embedded engines and compiled-in runtimes", extras(spdx)),
            ("JavaScript packages (vendored bundles and their dependencies)", npm),
            ("Rust crates", crates),
        ]
        OUT.write_text(render(groups), encoding="utf-8", newline="\n")
        everything = [c for _, comps in groups for c in comps]
        missing = [c.label for c in everything if not c.texts]
        synthesized = [c.label for c in everything if c.synthesized]
        print(f"→ {OUT.name}: {len(everything)} components, {OUT.stat().st_size / 1024:.0f} KB")
        if synthesized:
            print(f"  {len(synthesized)} without a license file (SPDX text used): {', '.join(synthesized)}")
        if missing:
            sys.exit(f"no license text for: {', '.join(missing)}")
    finally:
        if args.keep:
            print(f"temporary folder kept: {work}")
        else:
            shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
