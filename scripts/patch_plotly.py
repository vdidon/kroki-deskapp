"""Patch de performance de `ui/vendor/plotly.min.js` (vectorize-text), à rendu identique.

Plotly gl3d transforme chaque libellé texte 3D (`scatter3d` en `mode: "...text"`, titres et
graduations d'axes) en triangles : fillText sur un canvas partagé, `getImageData`,
contours (surface-nets), simplification, nettoyage du graphe (clean-pslg), triangulation
(cdt2d). Sur un rapport à 4 figures et 298 libellés distincts, cette chaîne prenait
~9 s, dont 6,6 s dans clean-pslg — pour rien :

1. **clean-pslg** (module 332, fonction `L`) convertit *tous* les points en rationnels
   exacts (`big-rat`/`bn.js`, d'où les `gcd`) puis les reconvertit en flottants, même
   quand il n'existe aucun croisement d'arêtes à calculer (0 sur 588 appels mesurés). Un
   rationnel construit depuis un flottant redonne ce flottant : sans croisement, on
   garde les flottants (tri par comparaison numérique, `b()` accepte un nombre). Avec
   croisement, chemin exact inchangé.
2. **Remplissage du canvas** (module 7718) : avant chaque libellé, le canvas de
   8192×1024 était repeint en noir en entier. Hors de la zone salie par le libellé
   précédent il est déjà noir opaque (invariant posé par le premier remplissage plein) :
   on ne repeint que cette zone. Remplissage plein au premier appel et après tout
   redimensionnement (qui remet le canvas à zéro).
3. **`willReadFrequently`** sur ce canvas (module 4359) : il est relu à chaque libellé.

Validé le 2026-10-19 : 588 maillages identiques octet par octet à la chaîne d'origine
(séquence complète, mêmes options de police que Plotly) ; 4 figures 9,3 → 3,6 s.

À relancer après chaque mise à jour de `plotly.min.js` :
    uv run scripts/patch_plotly.py
Idempotent. Échoue si un motif n'est pas trouvé exactement une fois : le code amont a
changé, le patch est à réexaminer (et peut-être devenu inutile).
"""

from pathlib import Path

TARGET = Path(__file__).resolve().parent.parent / "ui" / "vendor" / "plotly.min.js"
MARKER = "/* kroki-desk: vectorize-text patch (scripts/patch_plotly.py) */\n"

REPLACEMENTS = [
    # 3. canvas relu à chaque libellé : backing CPU
    (
        'l=document.createElement("canvas"),l.width=8192,l.height=1024,u=l.getContext("2d"))',
        'l=document.createElement("canvas"),l.width=8192,l.height=1024,'
        'u=l.getContext("2d",{willReadFrequently:!0}))',
    ),
    # 1. clean-pslg : rationnels seulement s'il existe des croisements (G)
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
    # 2. ne repeindre que la zone salie par le libellé précédent
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
    # Octets bruts : ne pas laisser Python réécrire les fins de ligne du vendor.
    text = TARGET.read_bytes().decode("utf-8")
    if MARKER in text:
        print(f"déjà patché : {TARGET}")
        return
    for old, new in REPLACEMENTS:
        count = text.count(old)
        if count != 1:
            raise SystemExit(
                f"motif trouvé {count} fois (attendu : 1) — plotly.min.js a changé, "
                f"patch à réexaminer :\n  {old[:100]}"
            )
        text = text.replace(old, new)
    TARGET.write_bytes((MARKER + text).encode("utf-8"))
    print(f"patché ({len(REPLACEMENTS)} remplacements) : {TARGET}")


if __name__ == "__main__":
    main()
