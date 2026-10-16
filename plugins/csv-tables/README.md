# Plugin d'exemple csv-tables

Implémentation de l'exemple **§12.1** de `doc/plugin-protocol.md` (racine du
dépôt de l'application) : la capacité `document:markdown` seule. Un fichier
`.csv` (séparateur `;`, première ligne = en-têtes) s'affiche en table markdown ;
la vue source montre le CSV brut, le clic sommaire/preview retombe sur la bonne
ligne du fichier via les ancres.

Plugin **pédagogique** : il illustre le point d'extension minimal, pas un
support CSV sérieux (pas de quoting RFC 4180, pas de choix du séparateur).

## Contenu

- `manifest.json` — revendique `.csv` avec la seule capacité
  `document:markdown`.
- `main.js` — entry du worker : transform CSV → table + ancres, dégradation
  (bandeau + fence) sur fichier vide.

## Empaquetage / installation

```bash
# → dist/csv-tables-<version>.kdext (+ twin dist/csv-tables.kdext)
python pack_plugin.py plugins/csv-tables
```

Installer en déposant le `.kdext` sur une fenêtre de Kroki Desk, ou via le
bouton « Ajouter un plugin… » (dialog Plugins de la toolbar).

Boucle de dev sans repack : copier ce dossier dans
`%APPDATA%\kroki-deskapp\plugins\csv-tables\` puis relancer l'application.
