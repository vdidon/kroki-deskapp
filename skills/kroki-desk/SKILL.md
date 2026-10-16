---
name: kroki-desk
description: "Writes any deliverable Markdown document (report, analysis note, review, list of questions, documentation) meant for Kroki Desk, and opens a file in Kroki Desk at a precise reference (LaTeX label, section, line) to show the user the passage being discussed: Kroki diagrams, interactive Plotly, formulas, `file#fragment` links (`.md`, `.tex`)."
argument-hint: "document subject"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash(curl:*)
---

# Kroki Desk Document Writer

Write deliverable Markdown documents for Kroki Desk — with diagrams when they help,
choosing the optimal engine among 29+ supported by Kroki.

**No figure in your task?** (review, list of questions, analysis note…) Skip Phases 0–2
and go straight to Phase 3 — file location, naming, structure and **links** apply to
every document. Never add a diagram just because this skill is loaded.

**The deliverable is a Markdown FILE on disk, never a diagram pasted into the reply.**
A `graphviz`/`d2`/`mermaid` fence in the conversation is dead text: the terminal shows
raw source, nothing renders, and the work is lost when the session ends. The whole
document — prose, tables, figures — goes into a `.md` the user opens in a renderer.
Phase 3 is not optional formatting; it is the point of the skill.

If arguments were provided: $ARGUMENTS

## Phase 0: Check what the target viewer can actually render

**Kroki Desk embeds its engines** — no server, no Docker, no network. It renders
**18 of the 29 Kroki types**: 14 unconditionally, 3 more only if a JRE is installed,
1 more (`tikz`) only if a TeX distribution is installed. The remaining 11 require
an external Kroki server configured in the settings;
without one they display an error **whatever the syntax**. Picking one of those by
default is the single most common way this skill produces a dead diagram.

One call settles it — the local HTTP API is enabled by default on port 8442, but
the port is configurable and the server can be switched off:

```bash
curl -s --max-time 2 http://127.0.0.1:8442/v1/health
```

- **Answers** (`{"status":"pass","version":{…}}`) → the keys of `version` (minus
  `kroki`, which carries the app version) are the types this build renders, aliases
  included. Prefer an engine from that list.
- **Fails** (app closed, other port, server disabled) → fall back to the table
  below: it mirrors the engines compiled into Kroki Desk.
- **The target is not Kroki Desk** (GitLab, a real Kroki server, a public
  renderer) → the restriction is void, all 29 engines are on the table.

### Availability in Kroki Desk

| Runtime | Engines | Availability |
|---|---|---|
| JS / WASM (webview) | `mermaid` `graphviz` `d2` `vega` `vegalite` `nomnoml` `wavedrom` `bytefield` `dbml` `erd` `excalidraw` `bpmn` | Always |
| Rust (native) | `svgbob` `pikchr` | Always |
| JVM | `plantuml` `c4plantuml` `ditaa` | **Only if a JRE/JDK is on the machine** |
| TeX (local distribution) | `tikz` | **Only if `latex` and `dvisvgm` are on the PATH** (MiKTeX, TeX Live) — nothing embedded |
| Not embedded | `actdiag` `blockdiag` `nwdiag` `packetdiag` `rackdiag` `seqdiag` `structurizr` `symbolator` `umlet` `wireviz` `diagramsnet` | External Kroki server required |

⚠ `/v1/health` lists `plantuml`/`c4plantuml`/`ditaa` **even when Java is missing**,
and `tikz` even when TeX is missing — it reports what the app knows, not what the
machine can run. To settle it: `java -version` / `latex --version` and
`dvisvgm --version`, or the app's « Informations » dialog (the JVM or TeX group
shows *blocked*). If Java is unavailable, every UML default below falls back to
Mermaid or D2.

One extra is not a Kroki engine at all: `plotly`, live-rendered by Kroki Desk
(see [engines/plotly.md](engines/plotly.md)).

**Math is a given, never an engine.** `$…$` and `$$…$$` are assumed to render in
*any* target — Kroki Desk (KaTeX), GitHub, GitLab, VS Code, Obsidian, Jupyter.
They need no engine, no server, no Phase 0 check: a formula, an equation, a matrix,
an aligned derivation is written in dollars, full stop. Never wrap maths in a
diagram engine, and never make it a reason to reach for TikZ.

## Phase 1: Select the Engine

Determine the best engine from the user's description using the decision matrix
below. **⛔ marks an engine Kroki Desk cannot render locally** (external server
required); **☕ marks one that needs Java**; **📐 marks one that needs a local TeX
distribution**.

| Category | Engines | When to use |
|----------|---------|-------------|
| UML & Software | PlantUML ☕, Mermaid, D2, Nomnoml, UMlet ⛔ | Classes, sequences, activities, use cases, states |
| Architecture C4 | C4 PlantUML ☕, Structurizr ⛔ | System context, containers, components, deployment |
| Graphs & Flows | GraphViz, D2, Mermaid | Directed/undirected graphs, flowcharts, state machines |
| Database | ERD, DBML | Entity-relationship, database schemas |
| Network & Infra | NwDiag ⛔, PacketDiag ⛔, RackDiag ⛔ | Network topology, packet structures, server racks |
| Block diagrams | BlockDiag ⛔, SeqDiag ⛔, ActDiag ⛔ | Simple blocks, sequences, activity with lanes |
| Business Process | BPMN | Workflows, process modeling (XML-based) |
| Data Visualization | Vega, Vega-Lite | Charts, scatter plots, distributions, maps (static SVG) |
| Interactive charts | Plotly | Hover / zoom / pan data exploration — live, **Kroki Desk only** |
| Hardware & Digital | WaveDrom, Bytefield, Symbolator ⛔, WireViz ⛔ | Timing waveforms, bit fields, HDL, wiring |
| ASCII & Drawing | Ditaa ☕, SvgBob, Pikchr | ASCII art to SVG, syntax diagrams |
| Hand-drawn | Excalidraw, D2 (sketch mode) | Whiteboard-style, informal diagrams |
| Scientific | TikZ 📐 | LaTeX/PGF **figures** — for maths alone use `$$…$$`, always available |
| General drawing | diagrams.net ⛔ | draw.io format (experimental) |

**Default recommendations** — first choice is renderable by Kroki Desk out of the
box; the ⛔/☕/📐 variant is the better engine *when a Kroki server, Java or TeX is available*:

- **Sequence diagram** -> Mermaid, or PlantUML ☕ (complete)
- **Class/UML** -> D2 (modern) or Mermaid, PlantUML ☕ for strict UML
- **Flowchart** -> Mermaid (simple) or GraphViz (complex)
- **Architecture C4** -> C4 PlantUML ☕, or D2/GraphViz without Java; Structurizr ⛔ only against a server
- **Database schema** -> DBML (modern) or ERD (traditional)
- **Network topology** -> D2 or GraphViz (NwDiag ⛔ is purpose-built but unavailable locally)
- **Data charts (static)** -> Vega-Lite (simple) or Vega (complex)
- **Interactive chart (hover/zoom/pan)** -> Plotly (**Kroki Desk only**; for a portable/static chart use Vega-Lite)
- **Gantt/timeline** -> Mermaid
- **Mind map / WBS** -> Mermaid `mindmap`, or PlantUML ☕ `@startmindmap`
- **Digital waveform** -> WaveDrom
- **Packet structure** -> Bytefield (PacketDiag ⛔)
- **Server rack** -> D2 or GraphViz (RackDiag ⛔)
- **Wiring/cables** -> D2 or GraphViz (WireViz ⛔)
- **Hand-drawn style** -> Excalidraw or D2 with `sketch: true`
- **ASCII art** -> SvgBob (freeform), Ditaa ☕ (boxes)
- **Syntax/railroad** -> Pikchr
- **HDL component** -> SvgBob or D2 (Symbolator ⛔)
- **Formula / equation / matrix** -> **`$…$` / `$$…$$`**, always, in every target — not a diagram, no engine involved
- **Scientific figure** (geometry, plots, circuits) -> TikZ 📐 when TeX is installed (or against a server); otherwise D2/GraphViz/SvgBob
- **Business process** -> BPMN

For detailed head-to-head comparisons: [references/decision-matrix.md](references/decision-matrix.md)

## Phase 2: Generate the Diagram

Once the engine is selected, read its dedicated reference file for syntax, options, and a working example:

| Engine | Reference file |
|--------|---------------|
| PlantUML ☕ | [engines/plantuml.md](engines/plantuml.md) |
| Mermaid | [engines/mermaid.md](engines/mermaid.md) |
| D2 | [engines/d2.md](engines/d2.md) |
| GraphViz | [engines/graphviz.md](engines/graphviz.md) |
| C4 PlantUML ☕ | [engines/c4plantuml.md](engines/c4plantuml.md) |
| Structurizr ⛔ | [engines/structurizr.md](engines/structurizr.md) |
| ERD | [engines/erd.md](engines/erd.md) |
| DBML | [engines/dbml.md](engines/dbml.md) |
| BlockDiag / SeqDiag / ActDiag ⛔ | [engines/blockdiag.md](engines/blockdiag.md) |
| NwDiag / PacketDiag / RackDiag ⛔ | [engines/nwdiag.md](engines/nwdiag.md) |
| BPMN | [engines/bpmn.md](engines/bpmn.md) |
| Vega / Vega-Lite | [engines/vega.md](engines/vega.md) |
| Plotly (interactive, Kroki Desk) | [engines/plotly.md](engines/plotly.md) |
| WaveDrom | [engines/wavedrom.md](engines/wavedrom.md) |
| Bytefield | [engines/bytefield.md](engines/bytefield.md) |
| Ditaa ☕ | [engines/ditaa.md](engines/ditaa.md) |
| SvgBob | [engines/svgbob.md](engines/svgbob.md) |
| Pikchr | [engines/pikchr.md](engines/pikchr.md) |
| Nomnoml | [engines/nomnoml.md](engines/nomnoml.md) |
| UMlet ⛔ | [engines/umlet.md](engines/umlet.md) |
| Excalidraw | [engines/excalidraw.md](engines/excalidraw.md) |
| Symbolator ⛔ | [engines/symbolator.md](engines/symbolator.md) |
| TikZ 📐 | [engines/tikz.md](engines/tikz.md) |
| WireViz ⛔ | [engines/wireviz.md](engines/wireviz.md) |
| diagrams.net ⛔ | [engines/diagramsnet.md](engines/diagramsnet.md) |

**Only read the file for the selected engine.** Each file contains syntax reference, options, and a working example.

## Diagram block format (inside the document file)

This section describes how each figure is written **into the `.md` file** produced in
Phase 3 — not how to answer in the conversation.

Format as markdown code fence using the engine ID directly (NO `kroki-` prefix):

````markdown
```{engine-id}
{diagram source code}
```
````

**Engine identifiers** (exact values for the code fence):

| Engine | ID | Engine | ID |
|--------|-----|--------|-----|
| PlantUML | `plantuml` | Mermaid | `mermaid` |
| D2 | `d2` | GraphViz | `graphviz` |
| C4 PlantUML | `c4plantuml` | Structurizr | `structurizr` |
| ERD | `erd` | DBML | `dbml` |
| BlockDiag | `blockdiag` | SeqDiag | `seqdiag` |
| ActDiag | `actdiag` | NwDiag | `nwdiag` |
| PacketDiag | `packetdiag` | RackDiag | `rackdiag` |
| BPMN | `bpmn` | Bytefield | `bytefield` |
| Ditaa | `ditaa` | SvgBob | `svgbob` |
| Pikchr | `pikchr` | Nomnoml | `nomnoml` |
| UMlet | `umlet` | Excalidraw | `excalidraw` |
| Vega | `vega` | Vega-Lite | `vegalite` |
| WaveDrom | `wavedrom` | WireViz | `wireviz` |
| Symbolator | `symbolator` | TikZ | `tikz` |
| diagrams.net | `diagramsnet` | Plotly | `plotly` |

Aliases accepted by Kroki Desk: `dot`/`gv` → graphviz, `c4` → c4plantuml,
`vega-lite`/`vl` → vegalite, `puml`/`plant-uml` → plantuml, `drawio` → diagramsnet.
Prefer the canonical ID.

Include a brief HTML comment above the fence explaining the diagram purpose.

**Plotly is special** — it is **not** a Kroki engine (see [engines/plotly.md](engines/plotly.md)).
The fence carries a Plotly figure JSON (`{data, layout}`), inline **or** via `src=file.json`,
and renders **only in Kroki Desk**. Pair it with a same-stem PNG image just above the block
for portability:

````markdown
![Revenue 2024](figures/png/revenue.png)

```plotly src=figures/revenue.json
```
````

## Phase 3: Write the document to a file

**Hard rule — no diagram fence in the reply.** Everything you would have written as an
answer (analysis, tables, figures, recommendations) goes into one `.md` file. The
conversation gets a short report *about* that file, never a copy of it. Writing the
figure twice — once in the file, once in the reply — defeats the purpose and doubles
the reading cost.

### Where the file goes

In priority order:

1. **A path the user gave** — absolute authority, use it verbatim.
2. **A convention the repo declares** — a `CLAUDE.md`/`README` naming a reports or
   docs directory (`_workspace/`, `reports/`, `notes/`…). Check before defaulting.
3. **`doc/` then `docs/`** if either already exists at the working-directory root.
4. **The working directory** otherwise.

Never create a new directory tree to host the file unless the user asked for one.

### Naming, and never clobbering

- Filename: kebab-case derived from the subject — `backend-module-architecture.md`,
  `data-ingestion-flow.md`. No date in the name unless the document is a dated
  snapshot the user will want to keep alongside older ones.
- **Test for existence first** (`test -e`). If the file exists and the user did not
  name it explicitly, do not overwrite: ask, or pick a distinct name. A pre-existing
  file belongs to the user, even when its name looks generated.
- Encoding: UTF-8 **without BOM**, LF endings.

### Document structure

````markdown
# {Title}

{One-paragraph statement of what the document answers.}

## {Section}

{Prose, tables, measured numbers — the reasoning belongs in the file too.}

<!-- purpose of the figure, one line -->
```{engine-id}
{diagram source}
```

*Figure 1 — {caption}.* {One line reading the figure: what to look at.}
````

- Number the figures and caption them. A figure with no caption is a decoration.
- Keep every asset path **relative to the `.md`** (`figures/x.json`, `figures/png/x.png`)
  so the document survives being moved or committed.
- If validation was skipped or an engine is unavailable locally, say so **in the
  document**, near the affected figure — the person reading the file later is the one
  who needs to know.

### Links to a precise place (`file#fragment`)

Kroki Desk opens the target document, then scrolls to the element whose `id` equals
the fragment. Pick the fragment by **stability**, most stable first:

1. **An explicit anchor** — survives any edit around it.
   - `.md` you write or may edit: `<a id="q16"></a>` on its own line just above the
     target, linked as `other.md#q16`. Short, semantic ids (`q16`, `p15`, `nb2`).
   - `.tex` (latex-doc plugin): the `\label{}` **verbatim** — `modele.tex#eq:sigmaU`.
     Never the numbered form (`#eq-3`, `#sec-2-1`): it shifts with every insertion
     upstream.
   - A document served by another plugin: the anchors that plugin documents.
2. **A heading slug** — breaks as soon as the heading text is edited. GitHub rules:
   lowercase, punctuation dropped, **one hyphen per space** (not collapsed —
   `A — B` gives `a--b`), accents kept, duplicates suffixed `-1`, `-2`.
3. **A line number** `#L75` (range `#L75-L80`: start only) — **last resort**, for a
   target with no anchor you are allowed to add (someone else's file, unlabeled `.tex`
   passage). Kroki Desk ≥ 3.20.0 only; older versions just open the document at top.

Why line numbers come last: a broken anchor fails **visibly** (the document opens at
the top), whereas a stale line number **silently lands on the wrong passage** — the
reader trusts it. When you must use one, also write the number in the link text or
next to it (`[l.2390](modele.tex#L2390)`), so a drift is at least detectable, and
state in the document which version of the target the numbers refer to.

### Showing a passage right now (open Kroki Desk at a reference)

When the conversation is *about* a precise place in a `.md`/`.tex` — a chapter,
an equation, a theorem — you can open it in Kroki Desk scrolled to that place,
instead of quoting it. Same fragment syntax and **same stability order** as links
above (`\label` > heading slug > `#L<n>`).

**Always go through the skill's script — never locate or launch the exe yourself.**
It finds the installation where the installer recorded it, checks the version,
splits `path#fragment` exactly like the app, and launches detached:

| OS | Install | Where the script looks |
|---|---|---|
| Windows | MSI (any install folder) | `App Paths\kroki_deskapp.exe` (HKCU, then HKLM) → exe path; version from the exe |
| Debian 12 / Ubuntu 24.04 | `.deb` | `kroki_deskapp` on PATH (`/usr/bin`); version from `dpkg-query kroki-desk` |

```bash
# Windows — Bash tool
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w ~/.claude/skills/kroki-desk/scripts/open.ps1)" "C:/Users/…/modele.tex#eq:sigmaU"
```
```powershell
# Windows — PowerShell tool
& "$HOME/.claude/skills/kroki-desk/scripts/open.ps1" "C:/Users/…/modele.tex#eq:sigmaU"
```
```bash
# Linux
bash ~/.claude/skills/kroki-desk/scripts/open.sh "/home/…/modele.tex#eq:sigmaU"
```

Pass **one** argument: absolute path + `#fragment`, quoted. The script prints one
line `STATUS: detail` and exits with:

| Code | Status | What you do |
|---|---|---|
| 0 | `OPENED` | Done. Tell the user it is on screen. |
| 3 | `OPENED_PLAIN` | App < 3.20.0: opened **without** the fragment. Name the passage (section, equation) in your reply so the user can find it. |
| 2 | `NOT_INSTALLED` | No MSI / `.deb` install found. Do not hunt for a portable exe: give the path + fragment as a link in your reply. |
| 4 | `NOT_FOUND` | The file part does not exist — fix the path, do not retry blindly. |
| 5 | `NO_DISPLAY` | Linux without a graphical session (SSH, container): nothing to show, say so. |

- **Fails silently on the fragment.** An unknown fragment still returns `OPENED` —
  the document just opens at the top (or stays where it was if already open).
  Prefer a `\label` you have just read in the file over a guessed heading slug.
- **App already open** → new tab in its first window, focused. **Closed** → it starts
  on the document. Either way the script returns immediately.
- **Not covered**: portable builds, AppImage, macOS (no app), an agent that does not
  run on the user's desktop (SSH, cloud, WSL targeting the Windows app).
- **Use it sparingly**: it steals the focus. Open when the user asked to see the
  passage, or when showing it is clearly the answer — not for every file you cite.
  Several places to show? Write a document with links (Phase 3) rather than opening
  five tabs.

### What the conversation gets

A short report, in this shape and nothing more:

- the **path** to the file written (clickable), and whether it was created or updated;
- the **verdict / key finding** in one to three sentences — the reason the user asked;
- the **figure list**: number, one-line subject, engine used;
- **validation status**: validated against Kroki Desk, or skipped and why;
- any open question that blocks the document from being correct.

## Validate

Validate every generated diagram against the local Kroki Desk API — that is the
renderer the document will actually be read in, so a pass there means the diagram
displays.

**Gate it on Phase 0.** If the health probe failed, the app is not listening and
every POST below will fail the same way — **skip validation entirely**, do not run
the loop once per diagram. This is not a micro-optimisation: where a firewall
*drops* connections to a closed port instead of refusing them, each dead call waits
for the timeout — eight diagrams, eight timeouts, for a foregone conclusion. Deliver the
document and say validation was skipped.

> **Plotly is exempt** — it is not a Kroki engine, so there is no endpoint to POST to
> (a `plotly` POST 400s on the route). Do **not** run the HTTP loop for it. Instead check
> the figure JSON parses (strict JSON, no trailing commas/comments) and has a top-level
> `data` array; the only true render test is opening the document in Kroki Desk.

**⚠ 400 does not mean "syntax error".** Kroki Desk answers 400 for *any* render
failure, including « this engine is not embedded » and « Java not found ». Read the
**body**, never the status alone — otherwise you will loop rewriting a perfectly
valid TikZ source that was never going to render here.

```bash
DIAGRAM='{diagram source}'
BASE=http://127.0.0.1:8442   # port configurable in the app settings
body=$(curl -s --max-time 5 -w '\n%{http_code}' \
  -X POST "$BASE/{engine-id}/svg" -H "Content-Type: text/plain" --data-binary "$DIAGRAM")
code=${body##*$'\n'}; msg=${body%$'\n'*}
case "$code" in
  200) echo "OK — renders in Kroki Desk" ;;
  # Both "engine not embedded" and "Java not found" carry « serveur Kroki externe »;
  # no engine's own syntax error does. That phrase is the discriminator.
  400) case "$msg" in
         *"serveur Kroki externe"*)
           echo "ENGINE UNAVAILABLE here — the source may well be valid; switch engine or tell the user: $msg" ;;
         *) echo "SYNTAX ERROR — fix the source and retry: $msg" ;;
       esac ;;
  000) echo "Kroki Desk not running (or other port) — skip validation, deliver as-is" ;;
  *)   echo "Unexpected $code: $msg" ;;
esac
```

**No public fallback.** Do not validate against `https://kroki.io`: it sends the
document's content to a third-party server, may be filtered on the user's network,
and is not the renderer the document will be read in. If the local API is
unreachable, skip validation and deliver as-is.

When an engine is unavailable locally but is the right tool for the job (a real
Structurizr model, a PGF figure), say so in one line **in the document, next to that
figure**, rather than silently downgrading — the user may have an external Kroki
server, or may want to configure one, and that note has to survive the session.
