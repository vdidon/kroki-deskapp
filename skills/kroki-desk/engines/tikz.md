# TikZ

> 📐 **Needs a local TeX distribution.** Kroki Desk embeds nothing for TikZ: it
> compiles with the machine's `latex` + `dvisvgm` (MiKTeX or TeX Live), and only if
> both are on the PATH — otherwise via an external Kroki server, or not at all. Without
> TeX the block shows an error whatever the syntax, and the local API answers
> **HTTP 400**, same as a syntax error (the body mentions « serveur Kroki externe »),
> so do not "fix" a source that was never going to render here. Check
> `latex --version` / `dvisvgm --version`, or the « Informations » dialog; if TeX is
> missing, pick an embedded engine (`d2`, `graphviz`…) and say so in one line.

> **A formula never needs an engine**: `$…$` / `$$…$$` are assumed to render in every
> target (Kroki Desk, GitHub, GitLab, VS Code, Obsidian, Jupyter…). Reach for TikZ only
> for a real PGF *drawing* — geometry, plots, circuits — never merely to typeset maths.

**API ID**: `tikz` | **Output**: SVG, PNG, JPEG, PDF | **Best for**: Scientific figures, mathematical diagrams, publication-quality graphics

## Syntax

### Wrapper (Kroki requires the full document)

Kroki Desk also accepts a bare `tikzpicture` (it wraps it itself), but keep the
full document: it is the only form a Kroki server accepts.

```tikz
\documentclass[tikz]{standalone}
\usetikzlibrary{positioning,arrows.meta}
\begin{document}
\begin{tikzpicture}[options]
  % commands here
\end{tikzpicture}
\end{document}
```

### Basic commands

| Command | Usage |
|---|---|
| `\draw[opts] path;` | Draw a path |
| `\fill[opts] path;` | Fill without outline |
| `\filldraw[draw=c1,fill=c2] path;` | Outline + fill |
| `\node[opts] (name) at (x,y) {text};` | Node with text |
| `\path ... ;` | Path with no action (for coordinates) |
| `\coordinate (name) at (x,y);` | Named point, not drawn |

### Shapes (inside a path)

```
-- (x,y)          % straight line
|- (x,y)          % elbow: horizontal then vertical
-| (x,y)          % elbow: vertical then horizontal
rectangle (x2,y2) % rectangle
circle (r)        % circle of radius r
ellipse (rx and ry)
arc (start:end:r) % arc, e.g. arc (0:90:1)
grid (x2,y2)      % grid
parabola (x,y)    % parabola
to[out=90,in=0]   % Bézier curve
```

### Line styles

```
% Thickness: ultra thin | thin | semithick | thick | very thick | ultra thick
% Dashes    : dashed | dotted | dashdotted | densely dashed | loosely dotted
% Arrows    : -> | <- | <-> | -stealth | -latex | -{Stealth[scale=1.5]}
\draw[thick, dashed, ->] (0,0) -- (2,0);
```

### Colors and fill

```
\draw[blue!50] ...                   % 50% blue
\fill[red!30!white] (0,0) circle(1); % red+white mix
\filldraw[draw=black, fill=green!40, opacity=0.7] (0,0) rectangle (2,1);
% Named colors: red, green, blue, cyan, magenta, yellow, black, white, gray, orange, violet
```

### Nodes: shapes and positioning

```
% Shapes (requires \usetikzlibrary{shapes})
\node[draw, rectangle] ...
\node[draw, circle] ...
\node[draw, diamond, aspect=2] ...
\node[draw, ellipse] ...
\node[draw, rounded corners] ...

% Relative positioning (requires \usetikzlibrary{positioning})
\node[below=of A] (B) {text};   % spaced automatically
\node[right=2cm of A] (C) {};
% Anchors: above, below, left, right, above left, north, south east…

% Edge labels
\draw[->] (A) -- node[above] {label} (B);
\draw[->] (A) -- node[midway, sloped] {label} (B);
```

### Useful libraries

| Lib | Usage |
|---|---|
| `positioning` | `below=of node`, `right=2cm of node` |
| `arrows.meta` | Modern arrowheads: `{Stealth}`, `{Latex}`, `{Circle}` |
| `arrows` | Classic arrowheads (legacy) |
| `automata` | FSM: `initial`, `accepting`, `state` |
| `calc` | Coordinate calculations: `($(A)!0.5!(B)$)` |
| `shapes` | `diamond`, `ellipse`, `trapezium`, `cylinder`… |
| `shapes.geometric` | Additional geometric shapes |
| `decorations.pathmorphing` | `snake`, `zigzag`, `bumps` |
| `decorations.markings` | Markers along a path |
| `fit` | Node enclosing other nodes |
| `matrix` | Node matrices |
| `mindmap` | Mind maps |
| `trees` | Trees |
| `patterns` | Hatching: `north lines`, `crosshatch`… |
| `circuits` | Electrical schematics |
| `er` | Entity-relationship diagrams |

## Gotchas

- **Document wrapper REQUIRED**: Kroki expects a complete `.tex` file — without `\documentclass` + `\begin{document}`, rendering fails silently
- **Missing semicolon**: every TikZ command must end with `;` → error `"Giving up on this path. Did you forget a semicolon?"`
- `\usetikzlibrary{}` must come BEFORE `\begin{document}`
- `positioning` required for `below=of`, otherwise `below of=` (less precise legacy syntax)
- `arrows.meta` replaces `arrows` for modern arrowheads
- `ball color` does not render in SVG via Kroki (known limitation)
- Default coordinates are in cm; `(1,0)` = 1 cm to the right

## Examples

### Flowchart (existing)

```tikz
\documentclass[tikz]{standalone}
\usetikzlibrary{shapes,positioning}
\begin{document}
\begin{tikzpicture}[node distance=2cm, auto]
  \node[draw, rounded corners] (start) {Start};
  \node[draw, below=of start] (process) {Process};
  \node[draw, diamond, aspect=2, below=of process] (decision) {OK?};
  \node[draw, rounded corners, below=of decision] (end) {End};
  \node[draw, right=3cm of decision] (fix) {Fix};

  \draw[->] (start) -- (process);
  \draw[->] (process) -- (decision);
  \draw[->] (decision) -- node {yes} (end);
  \draw[->] (decision) -- node {no} (fix);
  \draw[->] (fix) |- (process);
\end{tikzpicture}
\end{document}
```

### Finite automaton (FSM)

```tikz
\documentclass[tikz]{standalone}
\usetikzlibrary{automata,positioning,arrows.meta}
\begin{document}
\begin{tikzpicture}[>={Stealth}, auto, node distance=3cm,
                    every state/.style={draw, circle, minimum size=1.5cm}]
  \node[state, initial] (q0) {$q_0$};
  \node[state, right=of q0] (q1) {$q_1$};
  \node[state, accepting, right=of q1] (q2) {$q_2$};

  \draw[->] (q0) edge[bend left] node {a} (q1)
            (q1) edge[bend left] node {b} (q0)
            (q1) edge            node {a} (q2)
            (q2) edge[loop right] node {a,b} (q2);
\end{tikzpicture}
\end{document}
```
