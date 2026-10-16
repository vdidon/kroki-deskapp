# Plugin d'exemple ini-highlight

Implémentation de l'exemple **§12.3** de `doc/plugin-protocol.md` (racine du
dépôt de l'application) : la capacité `highlight:code` seule. Les fences
```` ```ini ```` des documents markdown sont colorées (commentaires,
`[sections]`, `clé = valeur`) via des classes `hljs-*` stylées par le thème
hljs de l'hôte.

Plugin **pédagogique** : grammaire ligne à ligne maison, sans hljs vendoré —
il montre le contrat minimal (`highlight/render` → HTML de spans `hljs-*`
auto-échappé), pas un support INI exhaustif.

## Contenu

- `manifest.json` — revendique la coloration `ini` (`highlight:code`).
- `main.js` — entry du worker : coloration ligne à ligne, échappement HTML
  côté plugin (l'hôte re-sanitize en ne gardant que les spans `hljs-*`).

## Empaquetage / installation

```bash
# → dist/ini-highlight-<version>.kdext (+ twin dist/ini-highlight.kdext)
python pack_plugin.py plugins/ini-highlight
```

Installer en déposant le `.kdext` sur une fenêtre de Kroki Desk, ou via le
bouton « Ajouter un plugin… » (dialog Plugins de la toolbar).

Boucle de dev sans repack : copier ce dossier dans
`%APPDATA%\kroki-deskapp\plugins\ini-highlight\` puis relancer l'application.
