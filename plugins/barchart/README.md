# Plugin d'exemple barchart

Implémentation de l'exemple **§12.2** de `doc/plugin-protocol.md` (racine du
dépôt de l'application) : les capacités `fence:svg` + `read:siblings`. Dans
n'importe quel document markdown (ou dérivé d'un autre plugin) :

````markdown
```barchart max=120
CAL-26;98
Q3-26;61
M+1;24
```
````

ou, données externes — l'image de fallback jumelle (§6.3) joue alors
automatiquement :

````markdown
![fallback](ventes.png)
```barchart src=ventes.csv max=120
```
````

Plugin **pédagogique** : il illustre le point d'extension fence + le service
`host/readFile`, pas une bibliothèque de graphes.

## Contenu

- `manifest.json` — revendique la fence `barchart` (`fence:svg`) et la lecture
  des `.csv` voisins (`read:siblings`).
- `main.js` — entry du worker : parse `label;valeur`, échappe les labels,
  colorie le texte selon le thème effectif fourni par l'hôte.

## Empaquetage / installation

```bash
# → dist/barchart-<version>.kdext (+ twin dist/barchart.kdext)
python pack_plugin.py plugins/barchart
```

Installer en déposant le `.kdext` sur une fenêtre de Kroki Desk, ou via le
bouton « Ajouter un plugin… » (dialog Plugins de la toolbar).

Boucle de dev sans repack : copier ce dossier dans
`%APPDATA%\kroki-deskapp\plugins\barchart\` puis relancer l'application.
