# Installation

Kroki Desk se distribue sous quatre formes. Le binaire portable reste le
livrable principal ; les installeurs s'y **ajoutent** pour qui veut une
installation en bonne et due forme (menu des applications, associations de
fichiers, plugins livrés, désinstallation propre, mise à jour en place).

| Forme | Plateforme | Fichier |
| --- | --- | --- |
| Binaire portable | Windows 10/11 | `kroki_deskapp-<version>.exe` |
| Installeur MSI | Windows 10/11 | `kroki_deskapp-<version>.msi` |
| AppImage | Linux x86_64 | `kroki_deskapp-<version>-linux-x86_64-debian12.AppImage` |
| Paquet Debian/Ubuntu | Debian 12+, Ubuntu 24.04+ | `kroki_deskapp-<version>-linux-x86_64-debian12.deb` |
| Binaire Linux nu | Linux x86_64 avec `libwebkit2gtk-4.1` | `kroki_deskapp-<version>-linux-x86_64-debian12` |

Les **documents, réglages et plugins** de chaque utilisateur vivent dans son
profil (`%APPDATA%\kroki-deskapp\` sous Windows, `~/.config/kroki-deskapp/`
sous Linux) : ils sont partagés entre toutes les formes et survivent à une
désinstallation.

## Binaires portables

Un seul fichier, sans installation ni droits administrateur : le frontend, les
moteurs JS/WASM et les jars PlantUML/ditaa y sont embarqués.

- **Windows** : WebView2 Runtime requis, préinstallé depuis Windows 10 2004.
- **AppImage** : GTK et WebKitGTK embarqués, rien à installer —
  `chmod +x` puis lancer.
- **Binaire Linux nu** : plus léger, mais la machine doit fournir
  `libwebkit2gtk-4.1`.

Aucun plugin n'est préinstallé : les ajouter depuis le dialog Plugins
(cf. [plugins](../README.md#plugins)).

## Installeur Windows (MSI)

L'installation est **par machine** (`Program Files`), donc élévation demandée.
Une seule page de personnalisation : le choix des plugins livrés.

### Plugins livrés

Le MSI embarque les plugins de la [stratégie
d'embarquement](building.md#plugins-embarqués-dans-les-installeurs) ; la page
laisse cocher ceux à installer. Avec la stratégie par défaut :

| Propriété | Plugin | Apporte | Coché |
| --- | --- | --- | --- |
| `PLUGIN_LATEX_DOC` | `latex-doc` | `.tex` `.latex`, fences ` ```latex ` | oui |
| `PLUGIN_CSV_TABLES` | `csv-tables` | `.csv` | non |
| `PLUGIN_BARCHART` | `barchart` | fences ` ```barchart ` | non |
| `PLUGIN_INI_HIGHLIGHT` | `ini-highlight` | coloration ` ```ini ` | non |

Les trois derniers sont les exemples pédagogiques de la [spécification du
protocole de plugins](plugin-protocol.md) : embarqués pour être installables
sans réseau, pas pour être installés par défaut.

Les plugins cochés s'installent au **premier lancement** de chaque utilisateur
(le dossier des plugins est dans son profil) et se mettent à jour avec
l'application. Trois règles :

- une version plus récente installée à la main n'est jamais remplacée par une
  plus ancienne ;
- un plugin supprimé depuis le dialog Plugins n'est pas réinstallé ;
- décocher un plugin ne désinstalle pas celui qui serait déjà en place — la
  suppression se fait depuis l'application.

### Associations de fichiers

Elles n'ont pas de page. Seules celles des formats servis par un plugin
dépendent de la case correspondante.

| Extensions | Effet | Installé si |
| --- | --- | --- |
| `.kdws` `.kdext` | double-clic → Kroki Desk | toujours |
| `.md` `.markdown` `.mdown` `.mkd` `.txt` `.html` `.htm` | « Ouvrir avec » | toujours |
| extensions d'un plugin (`.tex` `.latex`, `.csv`…) | double-clic → Kroki Desk | plugin coché |

Installer un plugin, c'est choisir Kroki Desk pour ses formats : l'installeur
les réclame en application par défaut. Windows garde toutefois le dernier mot —
un format pour lequel vous avez déjà choisi une application la conserve, Kroki
Desk n'y apparaît qu'en suggestion. Les formats natifs partagés (Markdown,
texte, HTML) ne sont jamais réclamés : Kroki Desk s'ajoute seulement à « Ouvrir
avec », sans toucher à vos applications par défaut.

### Lancement par nom

Le MSI enregistre l'application dans *App Paths* : `start "" kroki_deskapp …`
(cmd), `Start-Process kroki_deskapp` (PowerShell) et Win+R la trouvent sans
modifier le PATH. Bash et `CreateProcess` ne lisent pas cette clé.

### Installation silencieuse

Les choix de la page se passent en propriétés publiques :

```
msiexec /i kroki_deskapp.msi /qn PLUGIN_CSV_TABLES=1 PLUGIN_LATEX_DOC=""
```

installe le plugin CSV — et l'association `.csv` avec lui — sans le plugin
LaTeX ni ses associations.

## Paquet Debian/Ubuntu (.deb)

À installer avec **apt**, qui résout les dépendances — `dpkg -i` ne le fait
pas :

```bash
sudo apt install ./kroki_deskapp-<version>-linux-x86_64-debian12.deb
sudo apt remove kroki-desk    # désinstallation
```

Il pose l'application dans `/usr/bin` (donc lançable par `kroki_deskapp`),
l'inscrit au menu des applications et associe les types de fichiers. Cible :
Debian 12+ et Ubuntu 24.04+ — le paquet exige `libc6 (>= 2.36)`, ce qui exclut
Ubuntu 22.04.

### Plugins livrés

Le paquet embarque les mêmes plugins que le MSI, mais un `.deb` n'a pas
d'interface pour vous laisser choisir. Ceux que la stratégie coche sont
installés au premier lancement de chaque utilisateur (avec la stratégie par
défaut : `latex-doc`), les autres seulement **déposés à côté**.

Les plugins déposés à côté s'installent depuis le dialog Plugins (« Ajouter un
plugin… »), en pointant `/usr/lib/Kroki Desk/example-plugins/`. Les règles de
mise à jour sont celles du MSI.

### Associations de fichiers

Kroki Desk s'ajoute à « Ouvrir avec » pour `.md` `.markdown` `.mdown` `.mkd`
`.html` `.htm` et pour les formats des plugins installés qui ont un type MIME
standard (`.tex` `.latex`), sans déloger vos applications par défaut. Pour
`.kdws`, `.kdext` et les formats propres à un plugin installé, il est le seul
candidat déclaré : le double-clic l'ouvre directement. Rien n'est imposé —
sous Linux, l'application par défaut est un choix utilisateur
(`~/.config/mimeapps.list`) qu'un paquet n'a pas à écrire.

Deux différences avec le MSI, assumées :

- **`.txt` n'est pas associé.** Linux n'a pas d'association par extension :
  `.txt` *est* `text/plain`, et le déclarer ferait apparaître Kroki Desk dans le
  « Ouvrir avec » de tout fichier texte (`.py`, `.conf`, `.log`…), qu'il ne sait
  pas ouvrir. Un `.txt` reste ouvrable par glisser-déposer ou par le sélecteur
  de l'application.
- **Les formats d'un plugin non installé ne sont pas associés** (`.csv` avec la
  stratégie par défaut) : le plugin qui les lit n'est pas là.
