# Decision Matrix for Kroki Engines

Quick-reference guide for selecting the right Kroki diagram engine based on your needs.

> **Availability first.** This matrix ranks engines by *fitness for the job*, not by
> what the reader's viewer can render. In **Kroki Desk** — the usual target — engines
> marked **⛔ are not embedded** (external Kroki server required; the block errors out
> whatever the syntax), **☕ need a JRE installed** and **📐 need a local TeX
> distribution**. When the ⛔/☕/📐 engine is the
> better tool but is unavailable, take the alternative and say so in one line rather
> than shipping a diagram that will not display. See Phase 0 of `SKILL.md`.

---

## Need-Based Selection

| I need to... | Primary | Alternative | Why |
|---|---|---|---|
| Draw UML class diagrams | PlantUML ☕ | D2, Nomnoml | PlantUML has fullest UML support |
| Show sequence interactions | PlantUML ☕ | Mermaid, SeqDiag ⛔ | PlantUML supports all sequence features |
| Create flowcharts | Mermaid | D2, GraphViz | Mermaid is simplest for flows |
| Design system architecture (C4) | Structurizr ⛔ | **C4 PlantUML ☕**, D2 | Structurizr DSL is purpose-built for C4 — but needs a server |
| Model database schema | DBML | ERD | DBML is more readable, modern |
| Visualize network topology | NwDiag ⛔ | **D2**, GraphViz | NwDiag is purpose-built — D2 is the embedded fallback |
| Show data charts/graphs | Vega-Lite | Vega | Vega-Lite for simple charts, Vega for custom |
| Show **interactive** charts (hover/zoom/pan) | Plotly | Vega-Lite (static) | Plotly renders live — Kroki Desk only, not portable |
| Draw digital waveforms | WaveDrom | -- | Only engine for timing diagrams |
| Show packet/byte structure | PacketDiag ⛔ | **Bytefield** | Bytefield is embedded and covers binary layouts |
| Draw server rack layout | RackDiag ⛔ | D2, GraphViz | Only engine for rack diagrams, but server-only |
| Create hand-drawn style | Excalidraw | D2 (sketch mode) | Excalidraw for most natural whiteboard feel |
| Convert ASCII art to SVG | Ditaa ☕ | **SvgBob** | Ditaa for box-heavy, SvgBob for line art (and no Java) |
| Create syntax/railroad diagrams | Pikchr | -- | Purpose-built for syntax diagrams |
| Model business processes | BPMN | PlantUML ☕ activity | BPMN for standard notation |
| Draw HDL components | Symbolator ⛔ | SvgBob, D2 | Only engine for hardware components, but server-only |
| Show cable/wiring | WireViz ⛔ | D2, GraphViz | Only engine for cable/connector diagrams, but server-only |
| Create Gantt charts | Mermaid | PlantUML ☕ | Both support Gantt |
| Draw mind maps | Mermaid `mindmap` | PlantUML ☕ `@startmindmap` | Mermaid is embedded and needs no Java |
| Write a formula / equation / matrix | **`$…$` / `$$…$$`** | -- | Assumed to render in every target — not a diagram, no engine |
| Create scientific figures | TikZ 📐 | D2, GraphViz, SvgBob | Full LaTeX/PGF, needs a local TeX distribution (or a server) — and useless for maths alone |
| Make general-purpose diagrams | D2 | GraphViz | D2 is modern and readable |
| Create activity diagrams with lanes | ActDiag ⛔ | **PlantUML ☕**, D2 | ActDiag for simple, PlantUML for complex |
| Show simple block relationships | BlockDiag ⛔ | **Mermaid**, D2 | BlockDiag is minimal and clean, but server-only |
| Draw a graph with custom layout | GraphViz | D2 | GraphViz gives full layout control |
| Create Work Breakdown Structure | PlantUML ☕ | Mermaid `mindmap` | PlantUML @startwbs |
| Draw deployment diagrams | PlantUML ☕ | Structurizr ⛔, D2 | PlantUML for UML style, Structurizr for C4 |
| Create object diagrams | PlantUML ☕ | D2 | Standard UML |
| Show state machines | Mermaid | PlantUML ☕, D2 | All support states, PlantUML most complete |
| Create use case diagrams | PlantUML ☕ | D2 | Standard UML use case |
| Draw timing diagrams | WaveDrom | PlantUML ☕ | PlantUML for UML timing, WaveDrom for digital |
| Create diagrams.net/draw.io | diagramsnet ⛔ | D2, Excalidraw | Experimental support, server-only |

---

## Head-to-Head Comparisons

### PlantUML vs Mermaid vs D2

The three most versatile general-purpose engines.

| Feature | PlantUML | Mermaid | D2 |
|---|---|---|---|
| UML completeness | Full (all 14 types) | Partial (7 types) | Not UML-focused |
| Syntax complexity | Medium (verbose) | Low (concise) | Low (clean, modern) |
| Visual quality | Good | Good | Excellent |
| Hand-drawn mode | No | No | Yes (sketch mode) |
| Theming | 33+ themes | Limited | 17 themes |
| Markdown native | Needs renderer | GitHub/GitLab native | Needs renderer |
| Learning curve | Medium | Low | Low |
| Best for | Full UML compliance | Quick markdown diagrams | Modern readable diagrams |

### ERD vs DBML

Database modeling engines.

| Feature | ERD | DBML |
|---|---|---|
| Syntax | Minimal text format | Modern structured format |
| Relationships | Crow's foot notation | Foreign key references |
| Column details | Name only | Name, type, constraints, notes |
| Visual output | Simple, clean | Detailed with types |
| Best for | Quick ER overviews | Detailed schema documentation |

### C4 PlantUML vs Structurizr

Architecture modeling engines.

| Feature | C4 PlantUML | Structurizr |
|---|---|---|
| Syntax | PlantUML macros | Dedicated DSL |
| C4 levels | All 4 levels | All 4 levels + extras |
| Multiple views | Manual | Built-in view system |
| Layout control | PlantUML-based | DSL-controlled |
| **In Kroki Desk** | ☕ Embedded, needs Java | ⛔ Not embedded — external server only |
| Best for | Teams already using PlantUML | Dedicated architecture docs |

**In practice**: in Kroki Desk with Java, use C4 PlantUML. Without Java or a server,
hand-roll the C4 boxes in D2 or GraphViz — the C4 notation is a convention, not a
feature of the engine.

### Vega vs Vega-Lite

Data visualization engines.

| Feature | Vega | Vega-Lite |
|---|---|---|
| Syntax | Verbose JSON | Concise JSON |
| Flexibility | Full control | Sensible defaults |
| Chart types | Everything | Common types |
| Data transforms | Full pipeline | Basic transforms |
| Best for | Custom/complex viz | Standard charts quickly |

### Plotly vs Vega-Lite

Interactive vs static data visualization. **Different targets**, not interchangeable.

| Feature | Plotly | Vega-Lite |
|---|---|---|
| Output | Live interactive HTML (hover/zoom/pan) | Static SVG/PNG |
| Renders in | **Kroki Desk only** | Any Kroki viewer (GitHub, server, etc.) |
| Kroki engine | No (front-end live engine) | Yes (HTTP `vegalite`) |
| Validation | JSON parse only (no endpoint) | POST to Kroki endpoint |
| Portability | None alone — needs a PNG fallback | Universal |
| Input | Plotly figure JSON (`{data, layout}`), inline or `src=` | Vega-Lite JSON spec |
| Best for | Exploring data live inside Kroki Desk | Charts that must render anywhere |

**Rule of thumb**: interactivity required and reader uses Kroki Desk → Plotly (with PNG
fallback). Otherwise → Vega-Lite.

### Ditaa vs SvgBob vs Pikchr

Text-to-drawing engines.

| Feature | Ditaa | SvgBob | Pikchr |
|---|---|---|---|
| Input | ASCII boxes | ASCII lines/art | PIC-like language |
| Output style | Clean with shadows | Clean SVG | Technical drawing |
| Shapes | Boxes, circles | Freeform | Programmatic |
| Best for | ASCII box diagrams | ASCII art conversion | Syntax/railroad diagrams |

---

## Output Format Support

Not all engines support all output formats. SVG is universally supported. Check this table when a specific format is required.

> ⚠ **Kroki Desk renders SVG only.** Its embedded pipeline produces SVG, and its local
> API rejects any other format with `Only the svg format is supported`. The PNG/JPEG/PDF/TXT
> columns below describe *upstream Kroki servers*, not the app. In Kroki Desk, ask for
> a raster only through the app's own HTML export, or supply the file yourself.

| Engine | SVG | PNG | JPEG | PDF | TXT |
|---|---|---|---|---|---|
| PlantUML | yes | yes | - | yes | yes |
| Mermaid | yes | yes | - | - | - |
| D2 | yes | - | - | - | - |
| GraphViz | yes | yes | yes | yes | - |
| C4 PlantUML | yes | yes | - | yes | yes |
| Structurizr | yes | yes | - | yes | yes |
| ERD | yes | yes | yes | yes | - |
| DBML | yes | - | - | - | - |
| BlockDiag | yes | yes | yes | - | - |
| SeqDiag | yes | yes | yes | - | - |
| ActDiag | yes | yes | yes | - | - |
| NwDiag | yes | yes | yes | - | - |
| PacketDiag | yes | yes | yes | - | - |
| RackDiag | yes | yes | yes | - | - |
| BPMN | yes | - | - | - | - |
| Bytefield | yes | - | - | - | - |
| Ditaa | yes | yes | - | - | - |
| SvgBob | yes | - | - | - | - |
| Pikchr | yes | - | - | - | - |
| Nomnoml | yes | - | - | - | - |
| UMlet | yes | yes | yes | - | - |
| Excalidraw | yes | - | - | - | - |
| Vega | yes | yes | yes | - | - |
| Vega-Lite | yes | yes | yes | - | - |
| WaveDrom | yes | - | - | - | - |
| WireViz | yes | yes | - | - | - |
| Symbolator | yes | yes | - | - | - |
| TikZ | yes | yes | yes | yes | - |
| diagramsnet | yes | - | - | - | - |

> **Plotly** is intentionally absent from this table: it is **not** a Kroki engine and
> produces no exportable format. Its output is live interactive HTML rendered by Kroki
> Desk only — supply your own same-stem PNG fallback for any other context.
