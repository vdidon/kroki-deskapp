# Changelog

Toutes les modifications notables de Kroki Desk sont consignées dans ce fichier.

Le format s'inspire de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/)
et le projet suit le [versionnage sémantique](https://semver.org/lang/fr/).

## [3.24.0] — 2026-10-16

### Ajouté
- **Double-clic sur les formats des plugins installés par le MSI.** Les
  extensions d'un plugin coché à l'installation ouvrent désormais Kroki Desk
  par défaut (`.tex`, `.latex`, `.csv`…), au lieu de n'apparaître que dans
  « Ouvrir avec ». Un format pour lequel vous avez déjà choisi une autre
  application la conserve.
- **Sélection des plugins embarqués configurable au build.** Les plugins
  livrés avec le MSI et le paquet `.deb`, et ceux cochés par défaut, sont
  décrits par un simple fichier texte (`bundled-plugins.default.txt`,
  surchargé localement par `bundled-plugins.txt`) ; noms et extensions sont
  lus dans les manifestes des plugins.

### Modifié
- **Réglages déplacés dans `%APPDATA%\kroki-deskapp\settings.json`**
  (Linux : `~/.config/kroki-deskapp/`), à côté des plugins. Les réglages d'une
  version précédente ne sont pas repris : thème, icônes et serveur Kroki sont
  à refaire une fois, et un plugin supprimé auparavant peut être réinstallé
  au premier lancement.
- Identifiant de l'application et éditeur affiché par l'installeur renommés.

## [3.23.1] — 2026-10-14

### Corrigé
- **Icône blanche sur l'épingle de la barre des tâches après une mise à jour
  par le MSI.** Le raccourci du menu Démarrer prenait son icône dans le cache
  de Windows Installer, dossier propre à chaque version et supprimé à la mise à
  jour suivante ; l'épingle, copie figée du raccourci, se retrouvait sans
  icône. Le raccourci la lit désormais dans l'exécutable. Une épingle déjà
  abîmée est à refaire une fois (désépingler, puis réépingler).

## [3.23.0] — 2026-10-12

### Ajouté
- **Option `-d` (`--detach`) en ligne de commande.** `kroki_deskapp -d
  "doc.md"` lance l'application détachée du terminal et rend la main
  immédiatement : depuis bash (Git Bash, Linux), le terminal n'attend plus la
  fermeture de l'application, et la fermer n'emporte plus l'application.

## [3.22.0] — 2026-10-05

### Ajouté
- **Repères des occurrences sur la barre de défilement.** Pendant une
  recherche dans le document (`Ctrl+F`), un trait marque chaque occurrence
  sur la barre de défilement, à sa hauteur dans le document — l'occurrence
  courante en orange. On voit d'un coup d'œil où se concentrent les résultats.
  Les repères suivent le redimensionnement, les zooms et les figures qui
  finissent de s'afficher ; la barre reste saisissable au travers.

### Corrigé
- **Chaque document garde sa propre occurrence courante.** Atteindre
  l'occurrence 3 dans un onglet puis passer à un autre ne place plus ce
  dernier à l'occurrence 3 : chaque document reprend celle qu'on y avait
  atteinte (tant que la requête n'a pas changé), ou la première.
- **Le contenu replié n'est plus compté dans la recherche.** Les occurrences
  situées dans un accordéon fermé (sources repliées,
  sections dépliables d'un plugin…) étaient comptées et la navigation y sautait sans rien montrer.
  Elles sont désormais ignorées par les trois recherches ; ouvrir ou fermer un
  accordéon met le compteur à jour en restant sur l'occurrence courante.

## [3.21.0] — 2026-09-25

### Ajouté
- **Détacher un onglet depuis son menu contextuel.** Le clic droit sur un
  onglet propose « Détacher dans une nouvelle fenêtre » : le document s'ouvre
  dans une fenêtre de même taille, décalée par rapport à la fenêtre d'origine —
  le même résultat qu'en tirant l'onglet hors de la barre, sans avoir à le
  faire glisser. L'entrée est désactivée sur le seul onglet d'une fenêtre.

## [3.20.0] — 2026-09-24

### Ajouté
- **Liens vers une ligne : `fichier.md#L75`.** Un lien dont le fragment est un
  numéro de ligne, à la manière de GitHub et VS Code (`#L75`, ou une plage
  `#L75-L80` dont seul le début compte), ouvre le document et amène cette ligne
  du source en haut de la vue — dans le même document comme vers un autre, en
  preview comme en vue code source, y compris pour les documents transformés
  par un plugin (`.tex`…), où le numéro désigne la ligne du fichier
  d'origine. Jusqu'ici, le document s'ouvrait mais restait en haut. Si le
  document porte réellement un élément d'identifiant `L75`, c'est lui qui prime.
- **Ouvrir un document à une référence depuis la ligne de commande.**
  `kroki_deskapp.exe "modele.tex#eq:sigmaU"` ouvre le document et défile
  jusqu'à la référence, avec la même syntaxe que les liens : `\label` LaTeX,
  section numérotée (`#sec-2-1`), ancre posée par un plugin, titre markdown ou
  numéro de ligne (`#L42`). Fonctionne que l'application soit déjà ouverte ou
  non — c'est ce qui permet à un agent de montrer directement le passage dont
  il parle. Un nom de fichier contenant lui-même `#` reste ouvrable tel quel.
- **Installeur : l'application se lance par son nom.** Le MSI l'enregistre
  dans *App Paths* : `start kroki_deskapp …`, `Start-Process kroki_deskapp …`
  et Win+R `kroki_deskapp` fonctionnent sans connaître son dossier
  d'installation ni la mettre dans le PATH.

## [3.19.0] — 2026-09-17

### Ajouté
- **Menu contextuel sur les onglets.** Un clic droit sur un onglet propose
  « Copier le chemin » (chemin complet du fichier), « Afficher dans
  l'explorateur de fichiers » (ouvre le dossier, fichier sélectionné),
  « Fermer les onglets à gauche », « Fermer les onglets à droite » et
  « Fermer les autres onglets ». L'onglet cliqué reste ouvert et devient
  l'onglet actif si celui qui l'était a été fermé. Les entrées sans objet
  (premier onglet, dernier onglet, onglet seul) sont grisées.

## [3.18.1] — 2026-09-16

### Corrigé
- **Sommaire et liens internes atterrissent de nouveau sur leur cible.** Sur un
  gros document, un clic dans le sommaire pouvait s'arrêter plusieurs sections
  avant la cible et y rester : les blocs encore jamais affichés n'avaient
  qu'une hauteur estimée, et le recalage censé rattraper l'écart après coup
  abandonnait parfois en chemin. La mise en page paresseuse introduite en
  3.14.1 est retirée : tout le document est mis en page à l'ouverture, les
  sauts (sommaire, liens `#ancre`, liens vers un autre document, synchro
  preview ↔ code source) visent donc des positions exactes du premier coup.

### Notes
- Contrepartie assumée : l'ouverture d'un très gros document mathématique
  retrouve son temps d'avant la 3.14.1 (de l'ordre de 1,4 s au lieu de ~0,6 s
  pour 100 Ko de source et près d'un millier de formules). Le voile de
  chargement couvre cette attente. Les bascules preview ↔ code source restent
  rapides : le DOM de chaque vue est toujours conservé.

## [3.18.0] — 2026-09-16

### Ajouté
- **Figures TikZ dessinées, si une distribution TeX est installée.** Un bloc
  ` ```tikz ` (document LaTeX complet, comme l'attend Kroki, ou simple
  `tikzpicture`) est désormais rendu en local par la distribution du poste —
  MiKTeX ou TeX Live, `latex` et `dvisvgm` sur le PATH — au lieu d'exiger un
  serveur Kroki externe. Même logique que Java pour PlantUML : rien n'est
  embarqué, la détection est faite une fois, et le dialog « Informations »
  affiche un nouveau groupe « Moteur TeX ». Le texte est converti en tracés :
  le SVG ne dépend d'aucune police. Environ 1 à 2 s par figure, mises en cache.
  C'est ce qui permet au plugin `latex-doc` 1.4.0 de dessiner les
  `tikzpicture` des documents `.tex`.
- La compilation se fait dans un dossier temporaire, sans `\write18`, avec un
  délai maximal de 60 s, et sans installation automatique de paquets sous
  MiKTeX (sa fenêtre s'ouvrirait en plein rendu) : un paquet manquant donne un
  message d'erreur qui le nomme. Une erreur TeX est rapportée avec sa ligne.

## [3.17.1] — 2026-09-07

### Modifié
- **Une session `.kdws` s'ouvre toujours dans au moins une fenêtre neuve.**
  Jusqu'ici sa première fenêtre se greffait sur la fenêtre cible — celle du
  drop, ou la première fenêtre ouverte pour un double-clic quand l'application
  tournait déjà : les onglets de la session venaient se mêler au travail en
  cours, sans moyen de les en distinguer. La fenêtre cible n'est désormais
  reprise que si elle est encore vide (démarrage sur un `.kdws`, fenêtre
  « déposer un fichier ») ; dès qu'elle contient un onglet, la session s'ouvre
  à côté. Le focus et le rapport d'ouverture suivent la première fenêtre de la
  session.

## [3.17.0] — 2026-09-03

### Ajouté
- **Zoom de page à la molette (`Maj+molette`).** Le zoom existant
  (`Ctrl+molette`) est un zoom *texte* : il grossit les caractères et reflue
  la colonne, mais une figure qui occupe déjà toute la largeur garde
  exactement sa taille — impossible de s'approcher d'un diagramme trop dense
  pour être lu en un écran. `Maj+molette` ajoute un vrai zoom de page : rien
  ne reflue, tout grossit — texte, figures, tableaux — et la page déborde en
  défilement horizontal, ce qui permet d'en parcourir une sous-partie. Le
  zoom se fait autour du curseur (le point survolé reste en place), de 1 à 8.
  Les deux zooms se composent ; `Ctrl+0` les remet tous deux à 1. La
  recherche `Ctrl+F` centre désormais aussi horizontalement une occurrence
  hors champ.

## [3.16.0] — 2026-08-28

### Ajouté
- **Installeur Windows (`.msi`) avec associations de fichiers.** L'application
  se distribuait jusqu'ici en exécutable unique à copier ; il fallait associer
  les types de fichiers à la main pour ouvrir un document par double-clic. Un
  installeur MSI s'ajoute désormais au binaire portable — qui reste produit et
  distribué tel quel. Il pose l'application dans `Program Files`, l'inscrit dans
  « Applications installées » (désinstallation propre, mise à jour en place
  d'une version à l'autre) et associe les types de fichiers.

  Rien n'est imposé pour autant : Kroki Desk **s'ajoute** à « Ouvrir avec »
  pour tout ce qu'il sait lire — `.md`, `.markdown`, `.mdown`, `.mkd`, `.txt`,
  `.html`, `.htm` — sans remplacer l'application par défaut. Le double-clic
  direct n'est réclamé que pour les formats qui lui appartiennent : `.kdws`
  (sessions) et `.kdext` (plugins), ainsi que ceux des plugins installés. Pour
  les autres, ce serait de toute façon sans effet : Windows protège le choix de
  l'utilisateur et ne déloge jamais un format déjà attribué — le réclamer ne
  ferait qu'écraser une valeur système que la désinstallation ne rétablirait
  pas.
- **Double-clic sur une archive `.kdext` : installation du plugin.** Corollaire
  de l'association ci-dessus. Une archive de plugin n'est pas un document ;
  ouverte depuis l'Explorateur, la ligne de commande ou une seconde instance,
  elle part désormais vers le flux d'installation — dialog de confiance compris,
  exactement comme un glisser-déposer sur la fenêtre. Elle s'affichait sinon
  comme un onglet de contenu binaire.
- **Tous les plugins livrés avec l'installeur, au choix.** Le MSI embarque les
  archives de l'intégralité des plugins du dépôt et une page de l'installeur
  laisse cocher ceux à installer : `latex-doc` (`.tex`, `.latex`) l'est
  d'emblée, les trois exemples de la spécification du
  protocole — `csv-tables` (`.csv`), `barchart`, `ini-highlight` — sont
  disponibles décochés. L'application installe les plugins retenus
  silencieusement à son premier lancement : associer `.tex` sans
  fournir le plugin correspondant n'aurait donné qu'un rendu dégradé.

  **Cette sélection commande aussi les associations** : `.tex` et `.latex` ne
  sont associés qu'avec `latex-doc`,
  `.csv` qu'avec `csv-tables` — associer un format dont le plugin est absent
  n'aurait donné qu'un onglet en erreur.

  Les plugins retenus sont ensuite **maintenus à jour** — installer une version
  plus récente de Kroki Desk met à jour ceux qu'elle apporte, sans rien
  demander. Trois garde-fous : une version plus récente installée à la main
  n'est jamais ramenée en arrière ; un plugin supprimé depuis le dialog Plugins
  n'est **pas** réinstallé au démarrage suivant ; et le réinstaller à la main le
  remet dans le circuit des mises à jour automatiques. Décocher un plugin dans
  l'installeur ne désinstalle pas celui qui serait déjà en place — la
  suppression se fait depuis l'application. C'est la seule voie d'installation
  qui se dispense du dialog de confiance : ces archives viennent du même
  installeur que l'exécutable, donc de la même chaîne de confiance. Le
  glisser-déposer et le dialog Plugins, eux, le conservent.
- **Paquet Debian/Ubuntu (`.deb`).** Pendant Linux de l'installeur Windows,
  aux côtés du binaire nu et de l'AppImage qui restent produits tels quels. Il
  s'installe par `sudo apt install ./kroki_deskapp-linux-x86_64-debian12.deb`,
  place l'application au menu, associe les types de fichiers et se désinstalle
  par `sudo apt remove kroki-desk`. Debian 12 et Ubuntu 24.04 ou plus récent.

  Les mêmes plugins sont livrés, avec la même sélection par défaut —
  `latex-doc` installé au premier lancement, les trois
  exemples de la spécification simplement déposés dans
  `/usr/lib/Kroki Desk/example-plugins/`, installables ensuite depuis le dialog
  Plugins sans réseau. Un paquet Debian n'a pas d'interface pour poser la
  question à l'installation ; le choix se fait donc après, pas pendant.

  Les associations suivent l'esprit de la version Windows : Kroki Desk
  **s'ajoute** à « Ouvrir avec » pour `.md`, `.markdown`, `.mdown`, `.mkd`,
  `.html`, `.htm`, `.tex` et `.latex` sans déloger vos applications par défaut,
  et le double-clic direct fonctionne pour `.kdws` et `.kdext`,
  dont il est le seul gestionnaire déclaré. Rien n'est imposé : sous Linux,
  l'application par défaut reste un réglage de l'utilisateur. Une seule
  différence assumée, `.txt` n'est pas associé — le système n'y distingue pas
  les extensions, et le réclamer aurait fait apparaître Kroki Desk pour tout
  fichier texte, y compris ceux qu'il ne sait pas ouvrir.

## [3.15.1] — 2026-08-25

### Corrigé
- **`diagramsnet` manquait à l'inventaire des moteurs du dialog « Informations ».**
  Le type était accepté dans une fence — l'écriture ` ```diagramsnet ` produisait
  bien un bloc de diagramme — mais il n'apparaissait dans aucun des quatre groupes
  de runtimes : ni parmi les moteurs intégrés, ni parmi ceux qui réclament un
  serveur Kroki externe. Qui cherchait s'il pouvait dessiner du draw.io ne
  trouvait donc rien, et n'apprenait la réponse qu'en voyant échouer le rendu. Il
  est désormais listé là où il appartient, avec les onze autres types reconnus par
  Kroki mais non embarqués. Aucun changement de rendu : le comportement était
  correct, c'est l'inventaire affiché qui était incomplet.

## [3.15.0] — 2026-08-24

### Ajouté
- **L'écran d'accueil liste tous les raccourcis clavier.** Il n'en montrait que
  trois sur la quinzaine que l'application reconnaît ; les autres n'étaient
  découvrables qu'en survolant un bouton de barre d'outils — ou pas du tout pour
  ceux qui n'ont pas de bouton (`Ctrl+Tab`, `F3`, zoom, `F5`). Ils sont désormais
  groupés par catégorie — fichiers et fenêtres, recherche, affichage — sous la
  zone de dépôt, avec les gestes souris équivalents (`Ctrl`+molette, clic molette
  sur un onglet, détachement par glisser).

## [3.14.2] — 2026-08-21

### Modifié
- **Les bascules preview ↔ code source ↔ markdown intermédiaire sont
  instantanées.** Chaque retour en preview reconstruisait le document de zéro —
  markdown-it, KaTeX, DOMPurify puis des dizaines de milliers de nœuds — pour
  réafficher exactement le même contenu. Le rendu de chaque vue est désormais
  conservé et simplement réaffiché : sur un document de 100 Ko, le retour en
  preview passe de **~500 ms à ~80 ms**. Les diagrammes déjà rendus le restent,
  au lieu d'être recalculés.
- **La position de lecture est mieux tenue lors d'une bascule.** Conséquence du
  point précédent : la vue retrouve les hauteurs qu'elle avait déjà mesurées,
  là où une vue reconstruite repartait d'estimations. La dérive signalée en
  3.14.1 tombe de ~780 px à quelques dizaines de pixels dès le deuxième
  aller-retour.

### Notes
- Le rendu conservé est abandonné dès que le document change — modification sur
  disque, changement de thème ou d'icônes, rafraîchissement manuel — de sorte
  qu'aucune vue ne peut afficher un contenu périmé.

## [3.14.1] — 2026-08-21

### Modifié
- **Mise en page paresseuse des documents volumineux : ouverture ~2× plus
  rapide.** Les blocs situés hors de l'écran ne sont plus mis en page tant
  qu'ils n'en approchent pas. Sur un document mathématique, les formules pèsent
  96 % des nœuds — 52 000 sur 54 000 pour 100 Ko de source — alors que quelques
  dizaines de blocs seulement sont visibles à un instant donné. Le même
  document de 100 Ko s'ouvre en ~630 ms contre ~1 400 ms, soit 1 870 ms avant
  les optimisations de cette série.
  Le contenu reste entier dans la page : la recherche dans le document, la
  recherche multi-documents, le sommaire et les liens internes retrouvent
  exactement les mêmes résultats qu'avant, et l'impression met en page le
  document entier. Les sauts de défilement se recalent une fois les blocs
  traversés réellement mis en page — un lien interne ou une entrée de sommaire
  atterrit au pixel près, comme avant.

### Notes
- La synchro preview ↔ code source peut, sur un très gros document, revenir
  quelques centaines de pixels à côté de sa position de départ après un
  aller-retour : la bascule reconstruit la vue, qui perd les hauteurs déjà
  mesurées. Sans effet sur la lecture, mais perceptible.

## [3.14.0] — 2026-08-21

### Ajouté
- **Voile de chargement pendant le rendu d'un document.** Un gros document
  laissait l'onglet vide sans rien afficher : un spinner et « Rendu du
  document… » couvrent désormais l'attente, à l'ouverture comme aux bascules
  preview / code source / markdown intermédiaire. Il n'apparaît que si le rendu
  dépasse ~180 ms, ou d'emblée si le document est assez volumineux pour que la
  phase bloquante empêche ce délai de se déclencher. Le contenu déjà affiché
  reste défilable dessous lors d'un rechargement sur modification disque, et
  l'animation, portée par `transform`, continue de tourner pendant que le
  thread principal est occupé.

### Modifié
- **Le rendu des gros documents LaTeX est ~25 % plus rapide** (plugin
  `latex-doc` 1.2.1) : la passe de collecte des définitions ne parse plus que
  le préambule. Mesuré sur un document de 100 Ko, 933 formules — 1 870 ms →
  1 400 ms.

## [3.13.0] — 2026-08-21

### Ajouté
- **Recherche dans le document (`Ctrl+F`), maison.** Une barre compacte
  s'ouvre dans le coin haut-droit de la zone de lecture : champ, compteur
  `n/m`, occurrence précédente / suivante et fermeture. Toutes les occurrences
  sont surlignées, la courante dans une teinte contrastée. `Entrée` /
  `Maj+Entrée` et `F3` / `Maj+F3` parcourent les résultats, `Échap` ferme. La
  recherche porte sur ce qui est affiché : elle suit le mode courant (preview,
  code source, markdown intermédiaire) et se recalcule à chaque bascule.
- **Options `Aa` / `ab` / `.*` dans les deux recherches.** Collées à droite du
  champ, à la manière d'un éditeur : respecter la casse, mot entier,
  expression régulière. Un motif invalide passe le champ en rouge au lieu de
  vider silencieusement les résultats.
- **Bouton de fermeture** sur le panneau de recherche multi-documents
  (`Ctrl+Maj+F`), à droite du champ.

### Modifié
- **La barre de recherche native de la webview est remplacée.** `Ctrl+F`, `F3`
  et `Ctrl+G` ouvrent désormais la barre de l'application. L'ancien panneau
  d'options (« Respecter la casse », « Mot entier », « Respecter les signes
  diacritiques ») disparaît avec elle : hors thème, hors traduction et sans
  rapport avec le modèle d'onglets de l'application.

### Notes
- « Mot entier » reconnaît les lettres accentuées, le grec et le cyrillique
  (`été`, `naïve` sont des mots entiers) là où le `\b` de JavaScript s'arrête à
  l'ASCII.
- Sommaire, recherche dans le document et recherche multi-documents partagent
  la même ancre à l'écran : ouvrir l'un ferme les autres.

## [3.12.0] — 2026-08-04

### Ajouté
- **Choix des icônes affichées, dans les Réglages.** Une section « Icônes
  affichées » liste les icônes des deux barres — celles de la fenêtre (ouvrir,
  session, recherche, rafraîchir, nouvelle fenêtre, informations) et celles du
  document (sommaire, code source, markdown intermédiaire, pleine largeur,
  export) — chacune avec son aperçu et sa case. Le réglage est commun à toutes
  les fenêtres et persiste au redémarrage.
- **Vue « markdown intermédiaire » disponible en release.** Le bouton qui
  affiche le markdown généré par un plugin de document (`.tex`…)
  n'est plus réservé aux builds debug : il s'active dans les Réglages,
  et reste **désactivé par défaut**. Il n'apparaît que sur les documents
  effectivement transformés par un plugin.

### Notes
- Seules les icônes explicitement cochées ou décochées sont enregistrées ;
  toutes les autres suivent leur défaut. Un défaut modifié dans une version
  ultérieure s'appliquera donc aux icônes jamais touchées, sans écraser un
  choix fait. « Réinitialiser » efface ces choix et rend la main aux défauts.
- L'icône « Réglages » reste toujours visible : c'est le seul point d'accès à
  ce dialogue.
- Masquer une icône ne retire pas la fonction quand elle a un raccourci
  (Ctrl+O, Ctrl+Maj+F, Ctrl+Maj+N, F5 restent actifs). Désactiver « Code
  source », « Markdown intermédiaire » ou « Pleine largeur » ramène les vues
  concernées à l'affichage normal, pour ne pas les laisser dans un état qu'on
  ne pourrait plus quitter.

## [3.11.1] — 2026-07-31

### Corrigé
- **Vue « code source » : marges parasites en haut et à gauche.** La vue
  reprenait le retrait de lecture destiné au preview centré, et réservait dans
  sa gouttière la place de cinq chiffres quel que soit le document. La première
  ligne colle désormais au haut de la zone et la gouttière est dimensionnée sur
  le nombre de lignes réel — les numéros et le code gagnent la largeur perdue
  (écart d'autant plus visible sous zoom de page).

## [3.11.0] — 2026-07-31

### Ajouté
- **Coloration syntaxique de la vue « code source »** : le bouton *code source*
  n'affiche plus du texte gris uniforme. Le Markdown est coloré par la
  grammaire embarquée dans l'application ; les formats servis par un plugin le
  sont par le plugin lui-même — `.tex`/`.latex` pour latex-doc,
  coloration ajoutée dans sa version 1.1.0. Un format sans grammaire reste en texte brut, comme avant.
  L'alignement preview ↔ source, les numéros de ligne et le repli des lignes
  sont inchangés : la coloration est peinte par-dessus les lignes déjà posées,
  sans en modifier ni le nombre ni la hauteur.
- La recherche (`Ctrl+Maj+F`) et le surlignage du mot sélectionné trouvent
  désormais les occurrences **à cheval sur deux couleurs** dans la vue source
  (elles auraient été perdues, la coloration coupant une ligne en plusieurs
  fragments de texte).

## [3.10.1] — 2026-07-21

### Corrigé
- **La 2ᵉ ligne d'onglets exploite toute la largeur de la fenêtre** : elle
  s'arrêtait au niveau des boutons d'action alors que ceux-ci n'occupent que
  la première ligne. Seule la 1ʳᵉ ligne s'arrête désormais avant les boutons,
  les onglets excédentaires passent dessous et disposent de la largeur
  entière — la compression des titres intervient plus tard et tronque moins.

## [3.10.0] — 2026-07-21

### Ajouté
- **Barre d'onglets sur deux lignes quand la place manque** : au lieu de
  compresser les titres dès que la première ligne est pleine, les onglets
  suivants passent sur une deuxième ligne en gardant leur largeur naturelle
  (les boutons d'action restent en haut à droite). La compression des titres
  ne reprend que lorsque les deux lignes sont pleines, répartie uniformément
  pour tenir sur exactement deux lignes. La barre revient d'elle-même sur
  une ligne quand des onglets sont fermés ou la fenêtre élargie. Le
  glisser-déposer d'onglets (réordonnancement, détachement) fonctionne sur
  les deux lignes.

## [3.9.1] — 2026-07-18

### Corrigé
- **Icône floue à certaines échelles d'affichage Windows** : l'icône de
  l'application (barre des tâches, barre de titre, Alt-Tab, Explorateur)
  pouvait apparaître floue aux échelles 125 %/150 %/200 %, Windows devant
  redimensionner une taille voisine. Le fichier `.ico` embarque désormais
  les 16 tailles de la grille DPI Windows (16 → 256 px, dont 20, 30, 36,
  40, 60, 72, 96, 180), encodées en BMP pour une compatibilité maximale
  avec le shell : chaque contexte trouve une correspondance exacte, sans
  mise à l'échelle.

## [3.9.0] — 2026-07-15

### Ajouté
- **Ouverture des pages HTML statiques** (`.html`, `.htm`) — notamment les
  exports HTML de l'application, qui se relisent désormais dans Kroki Desk.
  Dialogue Ouvrir, drag-drop, ligne de commande, sessions `.kdws` et liens
  relatifs des documents acceptent ces extensions. La page est affichée telle
  quelle dans un onglet, via une iframe sandboxée (aucun script exécuté) ;
  les actions de vue (source, sommaire, export, recherche globale) ne
  s'appliquent pas à ces onglets.

## [3.8.0] — 2026-07-15

### Ajouté
- **Sessions `.kdws`** : un fichier JSON qui liste des documents à rouvrir,
  groupés par fenêtre, dans l'ordre des onglets (onglet actif compris). Le
  nouveau bouton « pile » de la barre d'onglets enregistre l'état courant
  (toutes les fenêtres, la fenêtre appelante en tête) ; les chemins sont
  relativisés par rapport à l'emplacement du `.kdws` quand c'est possible
  (séparateur `/`, format portable Windows/Linux). Un `.kdws` s'ouvre par
  drag-drop, dialogue Ouvrir, ligne de commande ou double-clic (après
  association du type de fichier) : la première fenêtre de la session
  s'ouvre dans la fenêtre cible, les suivantes dans des fenêtres neuves.
  Les fichiers introuvables ou non pris en charge sont ignorés et signalés
  (toast) ; l'application ne restaure toujours rien automatiquement au
  démarrage.

## [3.7.0] — 2026-07-15

### Ajouté
- **Export du rendu en page HTML autonome** : nouveau bouton (flèche de
  téléchargement) dans la pile d'actions de vue, à droite du rendu. La page
  exportée embarque les feuilles de style de l'application (thème forcé ou
  automatique conservé), les diagrammes en SVG inline et les images locales en
  data-URI — consultable dans n'importe quel navigateur, sans l'application ni
  réseau. Les figures Plotly sont exportées figées (snapshot SVG, sans
  interactivité) ; les polices KaTeX ne sont pas embarquées (repli sur les
  polices système).

### Modifié
- **Barre d'onglets allégée** (deux boutons de moins) : la gestion des
  **plugins** se fait désormais depuis Réglages → « Gérer les plugins… », et le
  journal des modifications (**Nouveautés**) depuis le dialog d'information,
  renommé **« Informations »** — qui affiche maintenant aussi la version de
  l'application au-dessus de l'état des runtimes et moteurs.

## [3.6.0] — 2026-07-15

### Ajouté
- **Changelog de plugin** (protocole v1, §3.1) : un plugin peut embarquer un
  `CHANGELOG.md` à la racine de son archive `.kdext`. S'il est présent, sa
  carte dans le dialog Plugins gagne un bouton **« Nouveautés »** qui
  l'affiche dans le dialog changelog de l'application — rendu markdown
  sanitizé par l'hôte, sans exécuter le plugin. Convention de nommage pure :
  aucun champ de manifeste, compatible avec les plugins existants.

## [3.5.0] — 2026-07-15

### Ajouté
- **Archives `.kdext` : toutes les méthodes de compression zip usuelles** sont
  désormais acceptées à l'installation d'un plugin — Store (Copy), Deflate,
  Deflate64, BZip2, LZMA et Zstandard (jusqu'ici : Deflate et Store seulement).
  Une archive empaquetée avec 7-Zip passe donc quelle que soit la méthode
  choisie, à l'exception de PPMd (écarté volontairement, usage marginal), dont
  le refus affiche maintenant la cause réelle au lieu d'un « manifest.json
  absent » trompeur.

## [3.4.0] — 2026-07-13

### Ajouté
- **Capacité de plugin `fence:markdown`** (protocole v1, §6.3) : un plugin peut
  rendre un bloc fence en **markdown dérivé**, repassé dans le pipeline complet
  de l'application (markdown-it + DOMPurify) puis hydraté récursivement —
  diagrammes Kroki natifs et colorations plugin inclus. Profondeur
  d'imbrication bornée, `data-source-line` dérivés neutralisés.
- **Bouton « Ouvrir le dossier »** dans le dialog Plugins : ouvre le dossier
  des plugins (`%APPDATA%\kroki-deskapp\plugins` sous Windows,
  `$XDG_CONFIG_HOME/kroki-deskapp/plugins` sous Linux) dans le gestionnaire de
  fichiers de la plateforme — le dossier est créé s'il n'existe pas encore.
  Pratique pour la boucle de développement des plugins (copie directe d'un
  dossier `plugins/<id>/`).

## [3.2.0] — 2026-07-13

### Ajouté
- **Recherche dans tous les documents ouverts** (bouton loupe de la barre
  d'onglets ou `Ctrl+Maj+F`) : un panneau cherche le texte tapé dans le
  **source** de chaque onglet de la fenêtre (insensible à la casse, y compris
  les onglets jamais affichés). Résultats groupés par document avec numéro de
  ligne et extrait ; cliquer un résultat active l'onglet et amène la ligne en
  haut de la vue (preview comme vue source), toutes les occurrences étant
  surlignées dans la vue affichée tant que le panneau est ouvert. `Échap`
  ferme le panneau.

## [3.1.0] — 2026-07-13

### Modifié
- Évolutions internes, sans effet sur les fonctionnalités de cette
  distribution.

## [3.0.0] — 2026-07-13

### Ajouté
- **Système de plugins** (protocole v1, spec `doc/plugin-protocol.md`) : des
  archives `.kdext` ajoutent des types de fichiers (`document:markdown`), des
  langages de fence (`fence:svg`/`fence:html`) et des colorations
  (`highlight:code`) **sans recompiler l'application**. Chaque plugin tourne
  dans un worker sandboxé (pas de DOM, pas de commandes Tauri, pas de disque —
  messages JSON uniquement ; lecture des fichiers voisins opt-in et confinée au
  dossier du document). Installation par glisser-déposer d'un `.kdext` sur la
  fenêtre ou via le nouveau dialog **Plugins** de la toolbar (cartes
  nom/description/version/état, suppression, bouton « Ajouter un plugin… ») ;
  dialog de confiance systématique (éditeur, version, capacités en clair),
  version précédente conservée en `.bak`. Les plugins vivent dans
  `%APPDATA%\kroki-deskapp\plugins` (chemin sans identifiant d'éditeur).
- **Script `scripts/pack_plugin.ps1`** : empaquette un dossier de plugin en
  `.kdext` dans `dist/`.

### Modifié
- **CSP** : le protocole `plugin://` (lecture seule, confiné au dossier des
  plugins) est autorisé en `script-src`/`connect-src` pour le chargement des
  modules et assets des plugins dans leur worker.

## [2.9.1] — 2026-07-10

### Modifié
- Évolutions internes, sans effet sur les fonctionnalités de cette
  distribution.

## [2.9.0] — 2026-07-10

### Modifié
- Évolutions internes, sans effet sur les fonctionnalités de cette
  distribution.

## [2.8.3] — 2026-07-09

### Modifié
- Évolutions internes, sans effet sur les fonctionnalités de cette
  distribution.

## [2.8.2] — 2026-07-09

### Modifié
- Évolutions internes, sans effet sur les fonctionnalités de cette
  distribution.

## [2.8.1] — 2026-07-09

### Modifié
- Évolutions internes, sans effet sur les fonctionnalités de cette
  distribution.

## [2.8.0] — 2026-07-09

### Modifié
- Évolutions internes, sans effet sur les fonctionnalités de cette
  distribution.

## [2.7.0] — 2026-07-08

### Modifié
- Évolutions internes, sans effet sur les fonctionnalités de cette
  distribution.

## [2.6.0] — 2026-07-08

### Modifié
- Évolutions internes, sans effet sur les fonctionnalités de cette
  distribution.

## [2.5.2] — 2026-07-08

### Modifié
- Évolutions internes, sans effet sur les fonctionnalités de cette
  distribution.

## [2.5.1] — 2026-07-07

### Modifié
- Évolutions internes, sans effet sur les fonctionnalités de cette
  distribution.

## [2.5.0] — 2026-07-07

### Modifié
- Évolutions internes, sans effet sur les fonctionnalités de cette
  distribution.

## [2.4.0] — 2026-07-07

### Modifié
- Évolutions internes, sans effet sur les fonctionnalités de cette
  distribution.

## [2.3.0] — 2026-07-07

### Ajouté
- **Bouton « Nouveautés »** dans la barre d'outils (icône horloge, à côté
  des boutons runtimes et réglages) : affiche le journal des modifications
  version par version, de la plus récente à la plus ancienne. Le changelog
  est embarqué dans l'exécutable à la compilation — toujours en phase avec
  la version installée, aucun accès réseau.

## [2.2.2] — 2026-07-07

### Modifié
- Évolutions internes, sans effet sur les fonctionnalités de cette
  distribution.

## [2.2.1] — 2026-07-07

### Corrigé
- **Libellé du groupe « Moteurs Java »** (fenêtre d'information des
  runtimes) : la parenthèse « (PlantUML, ditaa) » est retirée — redondante
  avec la liste des types affichée sous le groupe, et incomplète
  (c4plantuml manquait).

## [2.2.0] — 2026-07-07

### Modifié
- Évolutions internes, sans effet sur les fonctionnalités de cette
  distribution.

## [2.1.1] — 2026-07-07

### Modifié
- Évolutions internes, sans effet sur les fonctionnalités de cette
  distribution.

## [2.1.0] — 2026-07-07

### Modifié
- Évolutions internes, sans effet sur les fonctionnalités de cette
  distribution.

## [2.0.0] — 2026-07-06

### Ajouté
- **Liens vers une section d'un autre document** : un lien markdown relatif
  avec fragment (`[..](autre.md#section)`) ouvre le document cible dans un
  onglet puis défile jusqu'à l'ancre. Les liens `xlink:href` des SVG graphviz
  sont désormais cliquables.

## [1.12.1] — 2026-07-06

### Modifié
- Évolutions internes, sans effet sur les fonctionnalités de cette
  distribution.

## [1.12.0] — 2026-07-06

### Modifié
- Évolutions internes, sans effet sur les fonctionnalités de cette
  distribution.

## [1.11.1] — 2026-07-06

### Modifié
- Évolutions internes, sans effet sur les fonctionnalités de cette
  distribution.

## [1.11.0] — 2026-07-05

### Modifié
- Évolutions internes, sans effet sur les fonctionnalités de cette
  distribution.

## [1.10.0] — 2026-07-05

### Ajouté
- **Surlignage des occurrences du mot sélectionné** : sélectionner un mot dans le
  document met en évidence toutes ses autres occurrences (recherche insensible à la
  casse), en ambre pour se distinguer du bleu de la sélection. Repose sur la CSS
  Custom Highlight API — aucun nœud n'est injecté dans le DOM, donc les SVG des
  diagrammes, le mode source et la sélection native (peinte par-dessus) restent
  intacts. La mise en évidence disparaît dès que la sélection est vidée ou porte sur
  plusieurs mots.

## [1.9.1] — 2026-07-04

### Corrigé
- **Frontmatter YAML** en tête de document (`---` … `---`, typique des fichiers
  `SKILL.md`) : il était rendu en bouillie — le `---` d'ouverture devenait un
  trait horizontal et le bloc `clé: valeur` un paragraphe aggloméré puis un titre
  setext à cause du `---` de fermeture. Une règle de bloc markdown-it dédiée le
  capte désormais et l'affiche en table clé/valeur lisible. Les numéros de ligne
  source du reste du document sont préservés (alignement preview ↔ source intact).

## [1.9.0] — 2026-07-01

### Ajouté
- **Bouton « pleine largeur »** dans la pile d'actions de la vue (sous le bouton
  source) : bascule le preview entre sa largeur de lecture centrée (920 px) et
  toute la largeur de la fenêtre. Utile surtout au dézoom, où la largeur logique
  s'élargit et laissait sinon de larges marges vides sur les côtés. La position de
  lecture est préservée à la bascule (on reste au niveau du titre affiché en haut,
  comme pour le mode source). Les figures Plotly se réaccordent à la nouvelle
  largeur ; la vue source reste pleine largeur.

## [1.8.1] — 2026-06-30

### Corrigé
- **Ancres de sommaire avec ponctuation spéciale** : les liens internes (sommaire
  Markdown comme `[…](#…)`) vers un titre contenant ` — ` (tiret cadratin) ou `:`
  ne pointaient sur rien — clic sans effet. La génération de slug collapsait les
  espaces consécutifs en un seul tiret alors que GitHub en met un par espace
  (`Titre — sous` → `titre--sous`). Slugs alignés sur GitHub : un tiret par espace.

## [1.8.0] — 2026-06-29

### Ajouté
- **Bouton « Rafraîchir » global** : ajouté dans la barre d'actions à côté du
  bouton « Ouvrir », il relit **tous** les onglets ouverts depuis le disque et les
  re-rend. Les raccourcis **F5** et **Ctrl+R** restent limités à l'onglet **actif**.

## [1.7.0] — 2026-06-27

### Ajouté
- **Sommaire (table des matières)** : un bouton dédié, empilé au-dessus du bouton
  « code source » dans le coin haut-droit de la zone de rendu, déroule à sa gauche
  un panneau listant les chapitres et sous-chapitres (titres `#`…`######`,
  indentés par niveau). Un clic sur une entrée saute directement au titre — vers
  l'élément en mode *preview*, vers la ligne correspondante en mode *code source* —
  et referme le panneau. Le panneau se ferme aussi par un clic à l'extérieur, la
  touche `Échap` ou un changement d'onglet.

## [1.6.0] — 2026-06-27

### Ajouté
- **Affichage du code source d'un onglet** : un bouton flottant dans le coin
  haut-droit de la zone de rendu bascule l'onglet **actif** (et lui seul) entre le
  rendu *preview* et le **code source Markdown brut** en lecture seule (monospace,
  numéros de ligne). Le comportement par défaut à l'ouverture reste le *preview*.
  La bascule **préserve la position de lecture** : la première ligne affichée en
  haut reste alignée entre les deux modes (mappage via `data-source-line` sur les
  blocs du rendu).

## [1.5.0] — 2026-06-26

### Ajouté
- **Réglage de thème (Réglages → Thème)** : *Automatique* (suit le système, défaut),
  *Clair* ou *Sombre*, forçant l'apparence indépendamment du réglage Windows. Le
  forçage couvre toute l'interface — chrome, **corps du document** (`github-markdown`)
  et coloration syntaxique du code (`highlight.js`) — et pas seulement la palette de
  l'app. Le choix est persisté et propagé à toutes les fenêtres ouvertes en direct. En
  mode *Automatique*, l'interface continue de suivre les bascules système.

### Corrigé
- **Figures Plotly illisibles en thème sombre** : une figure ` ```plotly ` était
  posée sur la carte blanche réservée aux diagrammes Kroki tout en recevant un texte
  gris clair (gris sur blanc, illisible). Plotly est désormais rendu nativement en
  sombre — fond transparent (la figure se fond dans la page), texte clair et
  grilles/axes éclaircis sur tous les sous-graphes. Les diagrammes Kroki SVG
  (mermaid, graphviz, plantuml…), dont les couleurs sont figées par leur moteur,
  restent volontairement sur une carte blanche.

## [1.4.2] — 2026-06-26

### Corrigé
- **Survol (hover) décalé des figures Plotly sous zoom de page** : le zoom de page
  (`Ctrl +/-`, `Ctrl+molette`), appliqué via la propriété CSS `zoom`, faussait le
  hit-testing de Plotly — qui ne compense pas un `zoom` d'ancêtre : il dessine son
  plan en pixels logiques mais localise le curseur en pixels visuels, si bien que
  l'info-bulle pointait un autre point, avec un décalage croissant avec le zoom. La
  figure neutralise désormais l'échelle héritée (`--plotly-inv-zoom`, échelle
  effective 1:1) et son plan est réaccordé à la largeur de colonne via
  `Plotly.relayout` en préservant le ratio d'aspect — et non via `Plots.resize`, qui
  écrasait la hauteur d'un conteneur dépourvu de hauteur CSS.

## [1.4.1] — 2026-06-26

### Corrigé
- **Double affichage des figures Plotly** : lorsqu'une image statique
  (`![…](x.png)`) précède immédiatement un bloc ` ```plotly src=x.json ` de même
  *stem* (son fallback portable), les deux étaient rendus et chaque figure
  apparaissait en double. `hidePairedFallbackImage` masque désormais l'image une
  fois le rendu interactif réussi ; en cas d'échec, le PNG reste visible.

## [1.4.0] — 2026-06-26

### Ajouté
- **Graphiques Plotly interactifs** : un bloc ` ```plotly ` est rendu comme figure
  **interactive** (survol / zoom / pan) dans la fenêtre principale, en
  court-circuitant le pipeline SVG des moteurs Kroki. La spec `{data, layout}` est
  fournie en JSON inline ou via `src=fichier.json`. Le bundle Plotly (~4,8 Mo) est
  chargé à la demande à la première figure (script `'self'`, aucune modification de
  CSP — `'unsafe-eval'` est déjà autorisé pour d2).
- Commande backend `read_data_file` pour lire le JSON de spec, **confinée au dossier
  du document** : rejet des chemins absolus, protection anti-traversée (`..` /
  symlink) et allowlist `.json`.

## [1.3.0] — 2026-06-26

### Ajouté
- **Formules mathématiques** LaTeX en ligne (`$…$`) et en bloc (`$$…$$`), rendues
  par **KaTeX** embarqué (plugin `markdown-it-texmath`). Polices `.woff2` incluses
  dans l'exécutable : rendu local, sans réseau ni `eval`. Le profil `mathMl` de
  DOMPurify est activé pour préserver le MathML d'accessibilité.

## [1.2.0] — 2026-06-15

### Ajouté
- Moteurs de diagrammes **erd** et **excalidraw** embarqués.
- Moteur **ditaa** embarqué via un `.jar` (sortie SVG, exécuté en sous-process).
- Dialogue **« Runtimes & moteurs »** : état de chaque moteur (supporté / prérequis
  système manquant / non supporté).
- **Glisser-déposer** de fichiers texte depuis Cursor / VS Code
  (`CF_UNICODETEXT` / `text/uri-list`, au-delà du seul `CF_HDROP` de l'Explorateur).
- **Glisser-déposer de dossiers** : expansion vers leurs fichiers Markdown directs.
- Ouverture d'une **nouvelle fenêtre** lorsque l'exécutable est relancé.
- Support **Linux** dégradé (compilation conditionnelle, rendu JS/WASM sous
  WebKitGTK ; le drag inter-fenêtres reste spécifique à Windows).

### Performance
- Webview de rendu cachée démarrée hors du chemin critique de démarrage.
- Moteurs de diagrammes chargés **à la demande** plutôt qu'au boot.

### Supprimé
- `xdita.jar` orphelin retiré des assets.

## [1.1.0] — 2026-06-10

### Ajouté
- Moteurs **d2**, **dbml** et **bpmn**.

## [1.0.0] — 2026-06-10

### Ajouté
- Version initiale : visionneuse Markdown native Windows (Tauri 2 / Rust),
  rendu de diagrammes Kroki **intégré** (mermaid, plantuml, graphviz, svgbob,
  pikchr, vega/vegalite…) sans serveur, sans Docker, sans réseau.
- Markdown style GitHub : tables, listes de tâches, coloration syntaxique, ancres
  de titres, liens relatifs entre `.md`, images locales.
- **Onglets** (réordonnables, fermeture molette / `Ctrl+W`) et **multi-fenêtres**
  avec détachement d'onglet par glisser-déposer.
- Glisser-déposer de fichiers `.md`, rechargement automatique sur changement disque.
- **CLI** à instance unique et **API Kroki locale** (HTTP `127.0.0.1`), plus la
  prise en charge d'un serveur Kroki externe optionnel.

[3.24.0]: #3240--2026-10-16
[3.23.1]: #3231--2026-10-14
[3.23.0]: #3230--2026-10-12
[3.22.0]: #3220--2026-10-05
[3.21.0]: #3210--2026-09-25
[3.20.0]: #3200--2026-09-24
[3.19.0]: #3190--2026-09-17
[3.18.1]: #3181--2026-09-16
[3.18.0]: #3180--2026-09-16
[3.17.1]: #3171--2026-09-07
[3.17.0]: #3170--2026-09-03
[3.16.0]: #3160--2026-08-28
[3.15.1]: #3151--2026-08-25
[3.15.0]: #3150--2026-08-24
[3.14.0]: #3140--2026-08-21
[3.13.0]: #3130--2026-08-21
[3.12.0]: #3120--2026-08-04
[3.11.1]: #3111--2026-07-31
[3.11.0]: #3110--2026-07-31
[3.10.1]: #3101--2026-07-21
[3.10.0]: #3100--2026-07-21
[3.9.1]: #391--2026-07-18
[3.9.0]: #390--2026-07-15
[3.8.0]: #380--2026-07-15
[3.7.0]: #370--2026-07-15
[3.6.0]: #360--2026-07-15
[3.5.0]: #350--2026-07-15
[3.4.0]: #340--2026-07-13
[3.3.0]: #330--2026-07-13
[3.2.0]: #320--2026-07-13
[3.1.0]: #310--2026-07-13
[3.0.0]: #300--2026-07-13
[2.9.1]: #291--2026-07-10
[2.9.0]: #290--2026-07-10
[2.8.3]: #283--2026-07-09
[2.8.2]: #282--2026-07-09
[2.8.1]: #281--2026-07-09
[2.8.0]: #280--2026-07-09
[2.7.0]: #270--2026-07-08
[2.6.0]: #260--2026-07-08
[2.5.2]: #252--2026-07-08
[2.5.1]: #251--2026-07-07
[2.5.0]: #250--2026-07-07
[2.4.0]: #240--2026-07-07
[2.3.0]: #230--2026-07-07
[2.2.2]: #222--2026-07-07
[2.2.1]: #221--2026-07-07
[2.2.0]: #220--2026-07-07
[2.1.1]: #211--2026-07-07
[2.1.0]: #210--2026-07-07
[2.0.0]: #200--2026-07-06
[1.12.1]: #1121--2026-07-06
[1.12.0]: #1120--2026-07-06
[1.11.1]: #1111--2026-07-06
[1.11.0]: #1110--2026-07-05
[1.10.0]: #1100--2026-07-05
[1.9.1]: #191--2026-07-04
[1.9.0]: #190--2026-07-01
[1.8.1]: #181--2026-06-30
[1.8.0]: #180--2026-06-29
[1.7.0]: #170--2026-06-27
[1.6.0]: #160--2026-06-27
[1.5.0]: #150--2026-06-26
[1.4.2]: #142--2026-06-26
[1.4.1]: #141--2026-06-26
[1.4.0]: #140--2026-06-26
[1.3.0]: #130--2026-06-26
[1.2.0]: #120--2026-06-15
[1.1.0]: #110--2026-06-10
[1.0.0]: #100--2026-06-10
