# Changelog

Toutes les modifications notables de ce plugin sont documentées ici.
Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et le
versionnage [semver](https://semver.org/lang/fr/).

## [1.4.1] - 2026-10-09

### Corrigé

- **Table enveloppée dans un groupe.** Un environnement placé dans un groupe
  de mise en page (`{\small \begin{longtable}…}`) était aplati en texte : spec
  de colonnes et `&` s'affichaient tels quels. Le groupe est désormais déroulé.
- **`longtable`.** Sa spec de colonnes (et son option `[c]`) ne fuit plus dans
  la première cellule ; `\endhead`/`\endfirsthead` ne produisent plus
  d'avertissement, l'en-tête répété des pages suivantes et les pieds de page
  (`\endfoot`, `\endlastfoot`) sont retirés.

## [1.4.0] - 2026-09-16

### Ajouté

- **Figures TikZ dessinées.** Une `tikzpicture` devient une fence ` ```tikz `
  contenant un document LaTeX autonome, que Kroki Desk ≥ 3.18.0 compile avec
  la distribution TeX du poste (ou que le serveur Kroki configuré rend). Le
  document reprend du préambule ce qu'une figure peut utiliser — paquets
  mathématiques et graphiques, `\usetikzlibrary`, `\tikzset`, macros
  `\newcommand`, couleurs, taille de police de la classe — et fixe le numéro
  des `\ref`/`\eqref` qu'elle contient (y compris à travers une macro comme
  `\hyp{…}`). `babel` et les paquets de mise en page sont écartés : ils ne
  servent pas à la figure et peuvent manquer à la distribution du poste.
- Le texte des nœuds et le source TikZ restent disponibles, repliés sous la
  figure : ils prennent le relais sur un poste sans distribution TeX, où
  l'application affiche une erreur à la place du dessin. L'avertissement
  « figure TikZ non dessinée » disparaît, le plugin ne sachant pas si l'hôte
  dessinera.

## [1.3.0] - 2026-09-16

Écarts relevés en confrontant le rendu d'un document de 40 pages à son PDF.

### Ajouté

- **`\part`** : numérotation romaine (« Partie II », reprise par `\ref`), sans
  remettre à zéro les sections ; celles-ci descendent d'un niveau de titre.
- **Encadrés** `\fbox{\parbox{…}{…}}` rendus en citation, ou en bloc de code
  si le contenu est en `\ttfamily`.
- **`tikzpicture`** : avertissement visible, texte des `\node` restitué et
  source TikZ replié, au lieu des commandes de tracé déversées en texte.
- **Sous-titres** : `\title{Titre \\ \large Sous-titre}` rend le sous-titre
  sous le h1 au lieu de tout replier dans le titre.

### Corrigé

- **Numérotation des sections cassée par `\part`** : chaque partie consommait
  un numéro de section (« 5 Le modèle » au lieu de « Partie II »), décalant
  toutes les sections et références qui suivaient.
- **Annexes numérotées 1, 2… au lieu de A, B…** — et leurs ancres `sec-1`
  écrasaient celles des sections du corps : un lien vers « §3 » ouvrait
  l'annexe C.
- **Titre des environnements de théorèmes personnalisés** (`\begin{hypothese}[…]`)
  affiché entre crochets dans le corps.
- **En-têtes de théorèmes** : format amsthm « **Proposition 8** (Titre). »
  fondu dans le premier paragraphe, tête en italique pour `\theoremstyle{remark}`.
- **Expansion des macros** : `\sum\Kdiff` produisait `\sumK_{…}` (commande
  inconnue, formule en rouge) ; `\foo x` de corps `\alpha` produisait `\alphax`.
- **Espace après un mot de commande** non absorbée : `c\oe ur` s'affichait
  « cœ ur ».
- **Paragraphe débutant par un nombre** (`0.92 …`) préfixé d'un antislash
  visible.
- **Antislashs visibles dans le code inline** : `\texttt{B2B\_Market}`.
- **Spécification de colonnes** lue caractère par caractère : le `c` de
  `p{5cm}` passait pour une colonne centrée.
- **`\multicolumn{3}{l}{…}`** rendu « 3 l … » ; **`\rule{…}{…}`** rendu en
  dimensions.
- **Double marqueur** « 1. (a) » sur les `\item[(a)]` d'une `enumerate`.
- **Formule inline coupée** quand elle contient `\` + fin de ligne.
- **Ancres décalées** : la fusion finale des lignes vides décalait la
  synchronisation aperçu ↔ source de tout ce qui suivait (et vidait les lignes
  blanches des blocs `verbatim`).

## [1.2.1] - 2026-08-21

### Modifié

- **Transformation deux fois plus rapide sur les gros documents.** Le premier
  des deux parses ne sert qu'à collecter les définitions du préambule
  (`\newcommand`, `\newtheorem`, `\DeclareMathOperator`, `\title`…) : il ne
  porte plus que sur les quelques kilo-octets qui précèdent `\begin{document}`
  au lieu du document entier. Le parseur LaTeX domine le coût du rendu, et
  cette passe le payait deux fois. Repli automatique sur le source complet dès
  qu'une déclaration apparaît dans le corps (`\newtheorem` après
  `\begin{document}` est légal) : le markdown produit est inchangé, à l'octet
  près. Mesuré sur un document de 100 Ko (2 340 lignes, 933 formules) :
  `document/transform` passe de ~770 ms à ~390 ms, et le rendu complet dans
  l'application de ~1 870 ms à ~1 400 ms.

## [1.2.0] - 2026-08-04

### Ajouté

- **Ancres nommées d'après les `\label{}`** : chaque objet numéroté (équation,
  section, théorème, flottant) porte désormais, en plus de son ancre numérotée
  (`#eq-3`), une ancre reprenant **verbatim** le ou les labels qui le visent
  (`#eq:sigmaU`). Un autre document peut donc pointer une cible **stable** d'un
  `.tex` — `[σ_U](../doc/modele.tex#eq:sigmaU)` — là où l'ancre numérotée se
  décalait à la moindre insertion en amont. L'ancre est greffée sur la ligne
  existante : la synchronisation aperçu ↔ source est inchangée.

## [1.1.0] - 2026-07-31

### Ajouté

- Coloration `tex-source` / `latex-source` (capacité `highlight:code`) : la vue « code source »
  de l'application colore désormais les `.tex` — commentaires, formules
  (`$…$`, `$$…$$`, `\[…\]`), commandes de structure, noms d'environnement,
  commandes ordinaires, séparateurs de tableau. Coloriseur maison en une passe
  (`texhl.js`), sans highlight.js embarqué.

## [1.0.0] - 2026-07-22

### Ajouté

- Rendu des documents `.tex` / `.latex` autonomes (capacité `document:markdown`)
  et des fences ` ```latex ` (capacité `fence:markdown`).
- Structure : sections numérotées, `abstract`, `\title`/`\author`/`\date`.
- Mathématiques déléguées au KaTeX de l'application ; environnements non
  étoilés numérotés avec `\tag{n}`.
- Théorèmes `amsthm` : compteurs partagés (`[theorem]`) et parents
  (`[section]`), environnements étoilés non numérotés, `proof` avec ∎.
- Références croisées `\label`/`\ref`/`\eqref` résolues en liens d'ancre, y
  compris en avant ; référence à l'intérieur d'une formule rendue en texte nu.
- Expansion des macros du préambule : `\newcommand` (arguments et argument
  optionnel) et `\DeclareMathOperator`.
- Listes, tables (`tabular`, `array`, `longtable`), flottants avec légende
  numérotée, `verbatim`, `quote`, notes de bas de page.
- Texte : accents LaTeX, ligatures typographiques, symboles `textcomp`, liens,
  images.

[1.0.0]: https://github.com/vdidon/kroki-deskapp/releases/tag/latex-doc-1.0.0
