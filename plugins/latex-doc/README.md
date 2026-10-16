# Plugin latex-doc

Rendu des documents **LaTeX autonomes** (`.tex`, `.latex`) pour Kroki Desk, au
format du protocole de plugins v1 (`doc/plugin-protocol.md` à la racine du dépôt
de l'application). Ce dossier a vocation à devenir un dépôt autonome.

Le plugin ne rend aucune formule lui-même : il produit un **markdown dérivé**
dans lequel les mathématiques sont délimitées par `$…$` / `$$…$$` et confiées au
KaTeX déjà embarqué dans l'application. Tout le reste du pipeline (sommaire,
vue source, recherche globale, thème, export HTML) est gratuit.

## Contenu

| Fichier | Rôle |
| --- | --- |
| `manifest.json` | déclaration : extensions `.tex`/`.latex`, fence ` ```latex `, capacités |
| `main.js` | entry du worker — branche `document/transform` et `fence/render` |
| `tex.js` | toute la transformation LaTeX → markdown |
| `vendor/unified-latex.esm.js` | parseur LaTeX (bundle esbuild, ~245 Ko) |
| `build_vendor.py` | régénère le vendor depuis npm |

## Ce qui est rendu

- **Structure** : `\section`/`\subsection`/`\subsubsection` numérotées (les
  étoilées ne le sont pas), `abstract`, `\title`/`\author`/`\date` — un segment
  de titre ouvert par un changement de taille (`\\ \large …`) devient un
  sous-titre. `\part` est numérotée en romain (« Partie II », que `\ref`
  reprend) sans interrompre la numérotation des sections, qui descendent alors
  d'un niveau dans le sommaire ; après `\appendix`, les sections sont lettrées
  (A, B.2…).
- **Encadrés** : un paragraphe réduit à `\fbox{\parbox{…}{…}}` devient une
  citation, ou un bloc de code si son contenu est en `\ttfamily` (exemple de
  JSON, pseudo-code) — sauts `\\` et indentation `\hspace{…em}` conservés.
- **Mathématiques** : `$…$`, `\[…\]`, `equation`, `align`, `gather`, `multline`,
  `cases`, `pmatrix`… Les environnements non étoilés sont **numérotés** et
  reçoivent un `\tag{n}` rendu par KaTeX.
- **Théorèmes `amsthm`** : chaque `\newtheorem` du préambule est honoré, y
  compris le **compteur partagé** (`\newtheorem{proposition}[theorem]{…}`) et le
  compteur parent (`[section]` → numérotation `2.1`), et le titre optionnel
  des environnements personnalisés (`\begin{hypothese}[Titre]`). Comme chez
  amsthm, l'en-tête ouvre le premier paragraphe — « **Proposition 8**
  (Titre). Sous H1… » —, en gras ou en italique selon le `\theoremstyle`.
  `proof` devient « *Démonstration.* » et se clôt par un ∎.
- **Références croisées** : `\label`, `\ref`, `\eqref`, `\autoref`, `\pageref`
  sont résolus en **liens cliquables** vers une ancre du document — y compris
  les références en avant. Une référence apparaissant *dans* une formule
  (typiquement via une macro utilisateur) est rendue en texte nu : un lien
  markdown ne survit pas à l'intérieur d'un `$…$`.
- **Ancres nommées** : tout objet numéroté porte son ancre numérotée (`#eq-3`,
  `#sec-2-1`) **et** une ancre reprenant verbatim le ou les `\label{}` qui le
  visent (`#eq:sigmaU`) — cf. « Lier un `.tex` depuis un autre document ».
- **Macros du préambule** : `\newcommand` (avec arguments et argument optionnel)
  et `\DeclareMathOperator` sont **expansés** avant que la formule n'atteigne
  KaTeX, qui ne les connaît pas.
- **Listes** (`itemize`, `enumerate`, `description`, imbriquées), **tables**
  (`tabular`, `array`, `longtable` — alignement de la spec repris), flottants
  `table`/`figure` avec légende numérotée, `verbatim`/`lstlisting`, `quote`.
- **Texte** : gras/italique/monospace, accents LaTeX (`\'e` → é), ligatures
  (`---` → —, ` `` ` → “), symboles `textcomp` (`\euro` → €), notes de bas de
  page regroupées en fin de document, `\url`/`\href`, `\includegraphics`.

Une fence ` ```latex ` dans un `.md` ordinaire reçoit le **même rendu**, sans
titre de tête (capacité `fence:markdown`). Le langage ` ```tex ` n'est
volontairement **pas** revendiqué : il reste disponible pour afficher du code
LaTeX coloré au lieu de le rendre.

## Lier un `.tex` depuis un autre document

N'importe quel document ouvert dans l'application (markdown natif ou produit par
un autre plugin) peut pointer un objet précis d'un `.tex` **par son label**, en
chemin relatif au document courant :

```markdown
Diffusion du niveau [σ_U](../doc/modele.tex#eq:sigmaU),
définie en [annexe C](../doc/modele.tex#sec:annexeC).
```

L'application ouvre le `.tex` dans un onglet, le rend, puis scrolle jusqu'à
l'ancre. Le label est repris **verbatim** — `\label{eq:sigmaU}` donne
`#eq:sigmaU`, casse comprise : correspondance 1:1, aucune règle de
transformation à retenir. Dans l'autre sens, un `\href{../notes/plan.md#objectifs}{…}`
du `.tex` ouvre pareillement le document cible.

Deux précautions :

- **Viser un label, jamais une ancre numérotée.** `#eq-12` fonctionne mais
  désigne « la douzième équation » : insérer une équation en amont le fait
  pointer ailleurs, silencieusement. Même chose pour `#sec-c-5-table-de-synth-se`,
  le slug de repli d'une section étoilée, qui suit le texte du titre.
- **Un label sans objet numéroté n'a pas d'ancre.** Le `\label{}` doit suivre un
  objet que le plugin numérote — équation, section (étoilée comprise), théorème,
  flottant. Posé au fil du texte, il n'est pas ancrable : le lien ouvrira bien le
  document mais ne scrollera pas (et un `\ref` vers lui est déjà signalé en
  avertissement).

Hors de l'application, ces liens ne mènent nulle part : ni GitHub ni un
visualiseur markdown ordinaire ne rendent un `.tex` en HTML.

## Limites assumées

Le rendu est **sémantique**, pas typographique. Sans équivalent en markdown :
`geometry` et toute la mise en page, la pagination, les colonnes, le placement
des flottants, `\hspace`/`\vspace`, les styles de police fins.

- **Fichier unique.** Les imports (`\input`, `\include`) ne sont pas suivis : le
  plugin ne déclare pas la capacité `read:siblings`. Un document découpé en
  plusieurs fichiers ne rendra que son fichier maître.
- **Pas de bibliographie.** `\cite{clé}` affiche la clé entre crochets ;
  `thebibliography` est rendu comme du texte ordinaire.
- **TikZ dessiné par l'hôte, et seulement si le poste a une distribution TeX.**
  Le plugin ne dessine rien : il émet une fence ` ```tikz ` contenant un
  document autonome, que Kroki Desk ≥ 3.18.0 compile avec MiKTeX ou TeX Live
  (`latex` et `dvisvgm` sur le PATH), ou que le serveur Kroki configuré rend.
  Ce document ne reprend du préambule qu'une **liste blanche** de paquets
  (mathématiques, `xcolor`, `tikz`, `pgfplots`…), plus `\usetikzlibrary`,
  `\tikzset`, les macros et les couleurs : une figure qui dépend d'un autre
  paquet échoue avec un message qui le nomme. `babel` en est exclu (la
  césure y est donc anglaise). Sans TeX, l'application affiche une erreur à la
  place du dessin ; le texte des `\node` (dans l'ordre du source) et le source
  TikZ restent disponibles, repliés dessous. Dans une fence ` ```latex `, sans
  préambule, seules les bibliothèques chargées par la figure elle-même sont
  disponibles. PSTricks n'est pas pris en charge.
- **Corps des théorèmes en romain** : le style `plain` d'amsthm compose
  l'énoncé en italique ; le rendu ne le reproduit pas (un italique markdown ne
  traverse ni les formules ni les paragraphes).
- **`\euro` en mode math** compile mais KaTeX n'a pas de métrique pour « € » :
  le glyphe est emprunté à la police du système (avertissement en console, sans
  conséquence visible notable).
- Les macros définies **hors préambule** ou par `\def` avec paramètres
  délimités ne sont pas expansées.
- Un label **sans préfixe** qui porte le nom d'une propriété du DOM
  (`\label{title}`, `\label{location}`…) voit son ancre supprimée par le
  sanitizer de l'application (protection anti-*DOM clobbering*). La convention
  LaTeX usuelle — `eq:`, `sec:`, `tab:` — met à l'abri.

Un contenu que le plugin ne sait pas traiter ne fait jamais échouer le rendu :
la commande inconnue est remplacée par ses arguments et signalée en bandeau
d'avertissement ; une erreur interne affiche le source complet en fence.

## Développement

```bash
# 1. tests (autonomes : ni npm, ni application lancée)
node tests/test_latex_plugin.mjs                    # suite de non-régression
node tests/test_latex_plugin.mjs mon_doc.tex …      # + vrais documents

# 2. essai dans l'application : copier le dossier puis relancer l'app
#    (aucun rebuild nécessaire — le plugin n'est pas embarqué dans le binaire)
cp -r plugins/latex-doc "$APPDATA/kroki-deskapp/plugins/"

# 3. distribution
python pack_plugin.py plugins/latex-doc             # → dist/latex-doc-<version>.kdext
```

Le test compile **toutes** les formules produites avec le KaTeX vendoré du
dépôt : c'est la vérification qui compte, une formule refusée s'afficherant en
rouge dans l'application.

Pour régénérer le parseur vendoré (mise à jour d'`unified-latex`) :

```bash
python plugins/latex-doc/build_vendor.py            # npm + esbuild, dans un dossier temporaire
```
