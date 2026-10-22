#!/usr/bin/env python3
"""Packs a plugin folder into a .kdext archive (zip, manifest.json at the
root) → dist/<id>-<version>.kdext + unversioned twin <id>.kdext.

    python pack_plugin.py plugins/latex-doc

File selection: optional `packInclude` field of manifest.json — explicit
list of relative POSIX paths (e.g. "vendor/highlight.esm.js"); only those
files are packed, `manifest.json` and the `entry` being always included;
a listed path that does not exist is an error. Packaging-only field,
ignored by the host. Absent → the whole folder (except hidden files,
__pycache__ and dist/).

Installation: drop the .kdext onto a Kroki Desk window (trust dialog), or
the "Add a plugin…" button of the Plugins dialog.
Dev loop without repacking: copy the folder as is into
%APPDATA%\\kroki-deskapp\\plugins\\<id>\\ then restart the app.
"""

import argparse
import json
import shutil
import sys
import zipfile
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("plugin_dir", help="plugin folder (containing manifest.json)")
    args = parser.parse_args()

    plugin_dir = Path(args.plugin_dir).resolve()
    manifest_path = plugin_dir / "manifest.json"
    if not manifest_path.is_file():
        sys.exit(f"manifest.json not found in {plugin_dir}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    plugin_id, version = manifest.get("id"), manifest.get("version")
    if not plugin_id or not version:
        sys.exit("manifest.json: id/version fields required")

    # packInclude : liste explicite des fichiers à embarquer (chemins relatifs
    # POSIX) ; manifest.json et l'entry sont toujours inclus d'office.
    files = manifest.get("packInclude")
    if files is not None and (
        not isinstance(files, list) or not all(isinstance(f, str) for f in files)
    ):
        sys.exit("manifest.json: packInclude must be a list of relative paths")

    repo_root = Path(__file__).resolve().parent
    dist = repo_root / "dist"
    dist.mkdir(exist_ok=True)

    kdext = dist / f"{plugin_id}-{version}.kdext"
    twin = dist / f"{plugin_id}.kdext"
    kdext.unlink(missing_ok=True)
    twin.unlink(missing_ok=True)

    # Contenu du dossier à la racine de l'archive (manifest.json au premier
    # niveau). Exclusions : fichiers/dossiers cachés, __pycache__, et un
    # éventuel dist/ local (sinon les archives précédentes seraient embarquées).
    def excluded(rel: Path) -> bool:
        parts = rel.parts
        return (
            any(p.startswith(".") or p == "__pycache__" for p in parts)
            or parts[0] == "dist"
        )

    packed = 0
    with zipfile.ZipFile(kdext, "w", zipfile.ZIP_DEFLATED) as zf:
        if files is not None:
            # Ordre du manifeste, manifest.json et entry en tête, dédoublonné.
            entry = manifest.get("entry")
            selection = dict.fromkeys(["manifest.json"] + ([entry] if entry else []) + files)
            for rel_posix in selection:
                path = plugin_dir / rel_posix
                if not path.is_file():
                    sys.exit(f"packInclude: file not found: {rel_posix}")
                zf.write(path, rel_posix)
                packed += 1
        else:
            for path in sorted(plugin_dir.rglob("*")):
                rel = path.relative_to(plugin_dir)
                if path.is_file() and not excluded(rel):
                    zf.write(path, rel.as_posix())
                    packed += 1

    # Twin non versionné (même contenu, nom stable pour les scripts) :
    # hardlink de préférence (cf. publish_dist), copie en repli.
    try:
        twin.hardlink_to(kdext)
    except OSError:
        shutil.copyfile(kdext, twin)

    print(f"OK: {kdext} ({packed} files)")
    print(f"    {twin}")


if __name__ == "__main__":
    main()
