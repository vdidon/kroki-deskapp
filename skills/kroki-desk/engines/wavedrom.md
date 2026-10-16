# WaveDrom

**API ID**: `wavedrom` | **Output**: SVG only | **Best for**: Timing diagrams, waveform documentation, register bitfields

## Syntax

JSON root: `signal` array + optional `config`, `head`, `foot`, `edge`.

### Signal characters (`wave`)

| Char | Meaning |
|------|---------------|
| `0`  | Low level (stable) |
| `1`  | High level (stable) |
| `x`  | Unknown / undefined |
| `z`  | High impedance |
| `p`  | Posedge clock |
| `n`  | Negedge clock |
| `P`  | Posedge with arrow |
| `N`  | Negedge with arrow |
| `h`  | Weak high (pull-up) |
| `l`  | Weak low (pull-down) |
| `u`  | Rising (pull-up transition) |
| `d`  | Falling (pull-down transition) |
| `=`  | Named data (taken from `data[]`) |
| `2`-`9` | Colored data (indexed color, taken from `data[]`) |
| `.`  | Extends the previous state |
| `\|` | Timing gap (visual separator) |

### Per-signal properties

```
{ name, wave, data?, node?, period?, phase? }
```

- `data`: array or space-separated string — values displayed on `=`/`2`-`9`
- `node`: string of positional markers (e.g. `.a..b.`) — lowercase letters visible, `A-Z` invisible
- `period`: integer — multiplies the duration of each cycle
- `phase`: decimal — time shift (`0.5` = half a cycle early)

### Groupes (nesting)

```json
["GroupName",
  { "name": "sig1", "wave": "01.." },
  ["SubGroup",
    { "name": "sig2", "wave": "0.1." }
  ]
]
```

First string element = group label, the rest = signals or subgroups.

### Annotations (edge + node)

```json
{ "signal": [
  { "name": "A", "wave": "01.0.", "node": ".a..b" },
  { "name": "B", "wave": "0..1.", "node": "...c." }
],
  "edge": ["a->c setup", "b-|>c hold"] }
```

Edge syntax: `"srcNode[arrow]dstNode label"` (label = everything after the first space)

Available arrows:
- Curved: `~>`, `<~>`, `-~>`, `~->`, `-~`
- Straight: `->`, `-|>`, `-|->`, `|->`, `<->`, `<-|>`
- Junction: `+`

### Config / Head / Foot

```json
{ "config": { "hscale": 2, "skin": "narrow" },
  "head": { "text": "My title", "tick": 0 },
  "foot": { "text": "footer text", "tock": 0 } }
```

- `hscale`: integer ≥ 1 (horizontal zoom)
- `skin`: `"default"` | `"narrow"`
- `tick`/`tock`: cycle numbering (tick = on the marker, tock = between markers)
- `every`: marker display frequency

### Registers / Bitfield (reg)

```json
{ "reg": [
  { "bits": 3, "name": "OP",   "attr": "opcode" },
  { "bits": 4, "name": "dest", "type": 2 },
  { "bits": 5, "name": "src1" },
  { "bits": 1 }
]}
```

`reg[]` properties: `bits` (width), `name` (label), `attr` (annotation), `type` (color 1-7).

## Gotchas

- Strict JSON: **no trailing comma**, keys in double quotes
- `data` must have as many elements as there are `=`/`2-9` in `wave`, otherwise fields are empty
- `node` is a positional string: `.` = no marker, its length must match the cycles
- `period` multiplies all the cycles of the signal, it is not global — use `hscale` for the whole diagram
- Positive `phase` = early, negative = late (counter-intuitive)
- `|` in `wave` = visual gap only, does not shift the `node`s
- Groups cannot have a `wave` themselves
- `h`/`l` are weak states (CMOS), different from `0`/`1` (strong levels)

## Examples

### Simplified I2C protocol

```wavedrom
{ "signal": [
  { "name": "SCL", "wave": "p.......", "period": 2 },
  { "name": "SDA", "wave": "10.101.1", "data": ["A", "B"] },
  { "name": "state","wave": "x.=.=.x.", "data": ["ADDR", "DATA"] }
],
  "config": { "hscale": 1 },
  "head":  { "text": "I2C Transfer", "tick": 0 } }
```

### Timing annotations with edge

```wavedrom
{ "signal": [
  { "name": "clk",  "wave": "p......." },
  { "name": "data", "wave": "x.345x..", "data": ["A", "B", "C"] },
  { "name": "req",  "wave": "0.1..0..", "node": "..a..b.." },
  { "name": "ack",  "wave": "0..1..0.", "node": "...c..d." }
],
  "edge": ["a->c setup", "b-|>d hold"] }
```

### 32-bit register

```wavedrom
{ "reg": [
  { "bits": 1, "name": "W",    "attr": "write" },
  { "bits": 7, "name": "addr", "type": 2 },
  { "bits": 8, "name": "data", "type": 3 },
  { "bits": 16 }
]}
```
