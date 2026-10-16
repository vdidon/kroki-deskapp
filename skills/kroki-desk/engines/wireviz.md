# WireViz

> ⛔ **Not embedded in Kroki Desk.** This engine is recognised by Kroki upstream but
> is *not* compiled into the app: it renders only through an external Kroki server
> configured in the settings. Without one the block shows an error whatever the
> syntax — and the local API answers **HTTP 400**, same as a syntax error, so do not
> "fix" a source that was never going to render here. Pick an embedded engine
> (`d2`, `graphviz`, `mermaid`…) unless the user has a server, and say so in one line.

**API ID**: `wireviz` | **Output**: SVG, PNG | **Best for**: Cable/harness/wiring documentation, manufacturing specs

## Syntax

Top-level sections: `connectors`, `cables`, `connections`, `metadata?`, `options?`

### Connectors
```yaml
X1:
  type: "Molex KK 254"       # connector family (string)
  subtype: female             # variant
  pincount: 4                 # auto-inferred if pins/pinlabels given
  pins: [1,2,3,4]            # pin IDs (default: 1..N)
  pinlabels: [VCC,GND,TX,RX] # descriptive names
  pincolors: [RD,BK,YE,BU]  # per-pin color marks
  color: BU                   # box color
  notes: "power header"
  manufacturer: Molex
  mpn: 22-27-2041
  pn: X1-INTERNAL
  ignore_in_bom: false
  style: simple               # for single-pin connectors
  hide_disconnected_pins: true
```

### Cables
```yaml
W1:
  wirecount: 4                # or inferred from colors list length
  colors: [RD,BK,YE,BU]     # 2-char IEC codes; striped = GNYE
  color_code: IEC             # auto-generate: IEC | BW
  wirelabels: [+5V,GND,A,B]  # per-wire labels
  gauge: 0.25                 # mm² by default; suffix AWG for AWG
  length: 0.3                 # meters by default
  shield: true                # or color; access via wire ID 's'
  category: bundle            # dashed outline, per-wire BOM entries
  manufacturer: Alpha Wire
  mpn: 5040C
  pn: W1-INT
```

### Connections
```yaml
connections:
  - X1: [1-4]        # range expansion
    W1: [1-4]
    X2: [1-4]
  - [X3: 1, W2: 2, X4: 3]   # inline list form
  - X5: s            # connect shield
    W2: s
    GND: 1
```

Pin/wire references: `<int>` number | `<str>` label/color | `1-4` range | `[a,b,c]` list | `s` shield

Arrow notation (visual only, no wire): `-->` `<--` `<-->` `--` (single pin) | `==>` `<==` `<==>` `==` (whole connector)

### Metadata & Options
```yaml
metadata:
  project: "Power Harness v2"
  date: 2026-02-22
options:
  bgcolor: WH
  show_pincount: true
```

## Gotchas

- **pincount mismatch**: pin/wire counts in a connection set must match — error if not
- **pincount vs pins**: if `pins` or `pinlabels` provided, omit `pincount` (auto-inferred) or keep consistent
- **color ambiguity**: wire ref by color fails if multiple wires share the same color — use numbers instead
- **shield**: must explicitly use `s` as wire ID; `shield: true` alone does not connect it
- **category: bundle**: changes BOM to per-wire entries (intended for loose wire harnesses)
- **YAML indentation**: connection lists use `-` at top level; inline form `[A:1, W:1, B:1]` requires exact bracket syntax
- **unnamed templates** (`template.`): single-use only, cannot be referenced in later connection sets

## Examples

### Simple 4-wire harness
```wireviz
connectors:
  X1:
    type: Molex KK 254
    pincount: 4
  X2:
    type: Molex KK 254
    pincount: 4

cables:
  W1:
    wirecount: 4
    length: 0.3
    color_code: IEC

connections:
  - X1: [1-4]
    W1: [1-4]
    X2: [1-4]
```

### Shielded cable with labels and part numbers
```wireviz
connectors:
  P1:
    type: D-Sub
    subtype: female
    pincount: 3
    pinlabels: [TX, RX, GND]
    manufacturer: Amphenol
    mpn: L717SDE09P
  P2:
    type: D-Sub
    subtype: male
    pincount: 3
    pinlabels: [TX, RX, GND]

cables:
  W1:
    wirecount: 2
    colors: [WH, BU]
    gauge: 0.14
    length: 1.5
    shield: true

connections:
  - P1: [1,2]
    W1: [1,2]
    P2: [1,2]
  - P1: 3
    W1: s
    P2: 3
```
