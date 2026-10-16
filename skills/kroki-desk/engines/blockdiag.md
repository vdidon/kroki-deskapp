# BlockDiag / SeqDiag / ActDiag

> ⛔ **Not embedded in Kroki Desk.** This engine is recognised by Kroki upstream but
> is *not* compiled into the app: it renders only through an external Kroki server
> configured in the settings. Without one the block shows an error whatever the
> syntax — and the local API answers **HTTP 400**, same as a syntax error, so do not
> "fix" a source that was never going to render here. Pick an embedded engine
> (`d2`, `graphviz`, `mermaid`…) unless the user has a server, and say so in one line.

BlockDiag family: three tools sharing a DOT-like syntax.
**API IDs** : `blockdiag`, `seqdiag`, `actdiag` | **Output** : SVG, PNG, JPEG

**Common Kroki options** : `antialias`, `no-transparency`, `size` (WxH), `no-doctype`

---

## BlockDiag

**Best for** : block-and-arrow diagrams, simple architectures.

### Syntaxe

```
blockdiag {
  // Main flow
  A -> B -> C -> D;
  A -> E -> F -> D;
  // Node attributes
  A [label = "Start", color = "greenyellow", shape = "roundedbox"];
  D [color = "pink", stacked];
  // Group
  group web {
    label = "Web tier"; color = "#77FF77";
    A; B;
  }
  // Portrait subgroup
  group db {
    orientation = portrait;
    C; D;
  }
}
```

### Node attributes

| Attribute | Values | Default |
|---|---|---|
| `label` | string | node_id |
| `shape` | see list below | box |
| `color` | `#RRGGBB` \| color name \| `none` | white |
| `textcolor` | `#RRGGBB` \| name | black |
| `style` | `dashed`, `dotted` | solid |
| `width` / `height` | integer (px) | 128 / 40 |
| `fontsize` | integer | 11 |
| `numbered` | integer | — |
| `stacked` | flag | off |
| `background` | path \| URL | — |
| `icon` | path \| URL | — |
| `rotate` | 0, 90, 180, 270 | 0 |

**Shapes** : `box`, `roundedbox`, `diamond`, `minidiamond`, `ellipse`, `dots`, `note`, `cloud`, `mail`, `actor`, `beginpoint`, `endpoint`, `square`, `circle`, `flowchart.condition`, `flowchart.database`, `flowchart.input`, `flowchart.terminator`, `flowchart.loopin`, `flowchart.loopout`

### Diagram attributes

```
blockdiag {
  orientation = portrait;        // default: landscape
  default_fontsize = 13;
  default_shape = "roundedbox";
  default_node_color = "#EEEEEE";
  default_group_color = "orange";
  default_linecolor = "black";
  default_textcolor = "black";
  node_width = 160; node_height = 60;
  span_width = 64;  span_height = 40;
  edge_layout = flowchart;       // experimental
}
```

### Edge attributes

```
A -> B [label = "ok", color = "red", style = "dashed"];
A -> B [dir = "none"];     // no arrow
A -> B [dir = "back"];     // reversed arrow
A -> B [dir = "both"];     // double arrow
A -> B [folded];           // folding (complex layouts)
```

### Group — details

```
group {
  label = "Cluster"; color = "#AAFFAA"; textcolor = "navy";
  shape = "line";          // line | box (default box)
  style = "dashed";
  node1; node2;
}
```

Local `portrait` orientation inside a group: nodes stack vertically.

---

## SeqDiag

**Best for** : request/response sequences, protocols, API calls.

### Basic syntax

```
seqdiag {
  // Global options
  autonumber = true;
  activation = none;     // hides the activation bars

  // Participants (order of appearance = column order)
  browser; webserver; database;

  browser -> webserver [label = "GET /index"];
  browser <-- webserver [label = "200 OK"];

  webserver -> database [label = "SELECT"];
  webserver <-- database;
  browser <-- webserver;
}
```

### Arrow types

| Syntax | Meaning |
|---|---|
| `A -> B` | Synchronous |
| `A --> B` | Return / response (dashes) |
| `A ->> B` | Asynchronous |
| `A -->> B` | Asynchronous response |
| `A -> A` | Self-message (self-loop) |

### Notes

```
A -> B [label = "msg", note = "right annotation"];
A -> B [leftnote  = "text on the left"];
A -> B [rightnote = "text on the right"];
// Global note color
default_note_color = "#FFFFAA";
```

### Separators

```
=== Initialization ===    // separator line with title
...                       // delay (dotted line)
```

### Other edge attributes

```
A -> B [color = "red"];
A -> B [style = "dashed"];
A -> B [failed];           // marks a failed message
A -> B [diagonal];         // diagonal arrow
```

### Full example

```seqdiag
seqdiag {
  autonumber = true;
  browser -> webserver [label = "POST /login"];
  webserver -> auth [label = "verify(token)"];
  webserver <-- auth [label = "ok"];
  === Session open ===
  browser <-- webserver [label = "302 /dashboard"];
  ... delay ...
  browser -> webserver [label = "GET /dashboard"];
  browser <-- webserver;
}
```

---

## ActDiag

**Best for** : workflows with responsibilities (swimlanes).

### Syntaxe

```
actdiag {
  orientation = portrait;   // default landscape

  // Global flow (defines the order)
  write -> convert -> review -> publish;

  lane author {
    label = "Author";
    write   [label = "Write draft"];
    review  [label = "Review"];
  }
  lane system {
    label = "System";
    convert [label = "Convert to PDF"];
    publish [label = "Publish"];
  }
}
```

### Lane attributes

```
lane myLane {
  label = "Display name";
  color = "#DDDDFF";
  write; review;
}
```

### Node attributes (same as BlockDiag)

`label`, `color`, `textcolor`, `shape`, `style`, `width`, `height`, `fontsize`, `stacked`

### Diagram attributes

Same as BlockDiag: `orientation`, `default_fontsize`, `default_node_color`, `default_linecolor`, `node_width`, `node_height`, `span_width`, `span_height`.

---

## Gotchas

- **No HTML/Markdown in labels** — plain text only, no tags.
- **Flowchart shapes**: the `flowchart.` prefix is mandatory (`flowchart.condition`, not `condition`).
- **seqdiag participant order**: set by order of appearance in the file; declare the nodes explicitly at the top to control column order.
- **`activation = none`** must be set at diagram level, not on edges.
- **`stacked`** is a valueless flag (`node [stacked]`), not `stacked = true`.
- **blockdiag groups**: a node can belong to only one group; nested groups are not supported.
- **`orientation = portrait`** inside a group applies to that group only; `orientation = portrait` at diagram level affects everything.
- **Colors**: English CSS names accepted (`greenyellow`, `pink`, `navy`…) or `#RRGGBB`; no `rgba`.
- **seqdiag `<--`** is only a visual convention (same type as `-->`); what matters is the arrow direction.
- **actdiag without lanes**: valid, produces a simple activity diagram without swimlanes.
