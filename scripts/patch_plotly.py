"""Performance patch for `ui/vendor/plotly.min.js` (vectorize-text), with identical output.

Plotly gl3d turns every 3D text label (`scatter3d` with `mode: "...text"`, axis titles and
ticks) into triangles: fillText on a shared canvas, `getImageData`, contours
(surface-nets), simplification, graph cleanup (clean-pslg), triangulation (cdt2d). On a
report with 4 figures and 298 distinct labels, this chain took ~9 s, 6.6 s of it in
clean-pslg — for nothing:

1. **clean-pslg** (module 332, function `L`) converts *all* points to exact rationals
   (`big-rat`/`bn.js`, hence the `gcd`s) then converts them back to floats, even when
   there is no edge crossing to compute (0 out of 588 measured calls). A rational built
   from a float gives that float back: with no crossing, we keep the floats (sorted by
   numeric comparison, `b()` accepts a number). With a crossing, the exact path is
   unchanged.
2. **Canvas fill** (module 7718): before every label, the 8192×1024 canvas was fully
   repainted black. Outside the area dirtied by the previous label it is already opaque
   black (invariant set by the first full fill): only that area is repainted. Full fill
   on the first call and after any resize (which resets the canvas to zero).
3. **`willReadFrequently`** on that canvas (module 4359): it is read back for every label.

Validated on 2026-10-19: 588 meshes byte-for-byte identical to the original chain
(full sequence, same font options as Plotly); 4 figures 9.3 → 3.6 s.

Re-run after every update of `plotly.min.js`:
    uv run scripts/patch_plotly.py
Idempotent. Fails if a pattern is not found exactly once: the upstream code has
changed, the patch must be re-examined (and may have become unnecessary).
"""

from pathlib import Path

TARGET = Path(__file__).resolve().parent.parent / "ui" / "vendor" / "plotly.min.js"
MARKER = "/* kroki-desk: vectorize-text patch (scripts/patch_plotly.py) */\n"

REPLACEMENTS = [
    # 3. canvas read back for every label: CPU backing
    (
        'l=document.createElement("canvas"),l.width=8192,l.height=1024,u=l.getContext("2d"))',
        'l=document.createElement("canvas"),l.width=8192,l.height=1024,'
        'u=l.getContext("2d",{willReadFrequently:!0}))',
    ),
    # 1. clean-pslg: rationals only if there are crossings (G)
    (
        "N,H,ie=q.map(function(mt){return[c(mt[0]),c(mt[1])]});",
        "N,H,ie=G.length?q.map(function(mt){return[c(mt[0]),c(mt[1])]}):null;",
    ),
    (
        "var at=ie[mt[1]],ct=ie[Ht[1]];return f(at[0],ct[0])||f(at[1],ct[1])}",
        "if(!ie){var a1=q[mt[1]],c1=q[Ht[1]];return a1[0]-c1[0]||a1[1]-c1[1]}"
        "var at=ie[mt[1]],ct=ie[Ht[1]];return f(at[0],ct[0])||f(at[1],ct[1])}",
    ),
    (
        "j?V.push([ce,Be,He]):V.push([ce,Be])}return ie}",
        "j?V.push([ce,Be,He]):V.push([ce,Be])}return ie||q.map(function(mt){return[mt[0],mt[1]]})}",
    ),
    (
        "function b(q){var V=h(q);return",
        'function b(q){var V=typeof q=="number"?q:h(q);return',
    ),
    # 2. only repaint the area dirtied by the previous label
    (
        'V.height<Be&&(V.height=Be),G.fillStyle="#000",G.fillRect(0,0,V.width,V.height),G.fillStyle="#fff";',
        'V.height<Be&&(V.height=Be),G.fillStyle="#000",'
        "(!V.__kdDirty||V.__kdDirty[2]!==V.height||V.__kdDirty[3]!==V.width"
        '?G.fillRect(0,0,V.width,V.height):G.fillRect(0,0,V.__kdDirty[0],V.__kdDirty[1])),G.fillStyle="#fff";',
    ),
    (
        "var tt=be,je=ke+re*ge,Ue=l(G.getImageData(0,0,tt,je).data,[je,tt,4]);",
        "var tt=be,je=ke+re*ge;"
        "V.__kdDirty=[Math.min(V.width,tt+4*Se),Math.min(V.height,je+4*re),V.height,V.width];"
        "var Ue=l(G.getImageData(0,0,tt,je).data,[je,tt,4]);",
    ),
]


def main() -> None:
    # Raw bytes: do not let Python rewrite the vendor's line endings.
    text = TARGET.read_bytes().decode("utf-8")
    if MARKER in text:
        print(f"already patched: {TARGET}")
        return
    for old, new in REPLACEMENTS:
        count = text.count(old)
        if count != 1:
            raise SystemExit(
                f"pattern found {count} times (expected: 1) — plotly.min.js has changed, "
                f"patch to be re-examined:\n  {old[:100]}"
            )
        text = text.replace(old, new)
    TARGET.write_bytes((MARKER + text).encode("utf-8"))
    print(f"patched ({len(REPLACEMENTS)} replacements): {TARGET}")


if __name__ == "__main__":
    main()
