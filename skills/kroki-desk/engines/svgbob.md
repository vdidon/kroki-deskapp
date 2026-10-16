# SvgBob

**API ID**: `svgbob` | **Output**: SVG only | **Best for**: Freeform ASCII art converted into clean SVG

## Syntax

### Lines
| Char | Role |
|------|------|
| `-`  | solid horizontal line |
| `_`  | low horizontal line (aligned with the bottom of the cell) |
| `\|` | vertical line |
| `/`  | 60° diagonal |
| `\`  | 120° diagonal |
| `~`  | dotted horizontal line |
| `:`  | dotted vertical line |

### Corners and junctions
| Char | Role |
|------|------|
| `+`  | sharp corner or 4-way intersection |
| `.`  | rounded top-left or top-right corner |
| `,`  | rounded top-left corner |
| `'`  | rounded bottom-left or bottom-right corner |
| `` ` `` | rounded bottom-left corner |

### Arrows
| Char | Direction |
|------|-----------|
| `>`  | right (at the end of a `-`) |
| `<`  | left (at the start of a `-`) |
| `^`  | up (at the top of a `\|`) |
| `v` / `V` | down (at the bottom of a `\|`) |

Combinations: `->`, `<-`, `<->`, `-->`, diagonal arrows with `/` or `\`.

### Markers on lines
- `*` : small filled circle (connection point)
- `o` : small hollow circle
- `O` : larger hollow circle

### Shapes
- **Sharp box**: `+` corners, `-` and `|` sides
- **Rounded box**: `.` and `'` corners (or `,` `` ` ``)
- **Diamond**: `/` and `\` combined in a diamond shape
- **Circle/ellipse**: parentheses `( )` arranged around a space
- **Parallelogram**: `/` and `\` on the sides of a box

### Text
- Bare text: interpreted literally if surrounded by spaces (not adjacent to drawing characters)
- `"text"`: double quotes to force plain-text interpretation and prevent an adjacent `-` or `o` from being taken as a stroke/circle

## Kroki options

| Option | Default | Description |
|--------|--------|-------------|
| `background` | white | background color |
| `font-family` | arial | font |
| `font-size` | 14 | text size (px) |
| `fill-color` | black | fill color |
| `scale` | 1 | SVG scale factor |
| `stroke-width` | 2 | stroke thickness |

## Gotchas

- **Hyphen inside a word**: `co-edit` → the `-` is rendered as a stroke. Fix: put it in quotes, `"co-edit"`.
- **Context-dependent `o` and `O`**: in an ordinary word they are text; stuck to a stroke they become circle markers.
- **`_` vs `-`**: `_` draws at the bottom of the cell, useful for underlining but creates visual offsets when mixed with `-`.
- **Mixed corners**: mixing `+` (sharp) and `.`/`'` (rounded) on the same box gives an inconsistent result — pick a single style.
- **No inline colors**: unlike Ditaa, SvgBob has no color tags in the ASCII. Colors are global, via the options.
- **Proportional alignment**: SvgBob uses a fixed-spacing grid; misalignment in the editor produces wobbly shapes in the SVG.
- **No tags or per-shape styles**: Ditaa allows `{c}`, `{io}`, `{d}` to type boxes — SvgBob has no equivalent; the shape depends only on the ASCII geometry.

## Differences vs Ditaa

| Aspect | SvgBob | Ditaa |
|--------|--------|-------|
| Rounded corners | `.` `'` `,` `` ` `` | `/` in the corners |
| Box types | geometry only | `{c}`, `{io}`, `{d}`… tags |
| Inline colors | no (global options) | yes (`c[color]`) |
| Output | vector SVG | raster PNG |
| Dashed lines | `~` `:` | `=` (horizontal) |
| Circle markers | `o` `O` `*` | not native |

## Examples

### Rounded flowchart
```svgbob
       .-------.
      |  Start  |
       '---+---'
           |
           v
       .---+---.
      / Is it  /
     / valid? /
      '---+---'
       /     \
      v       v
  .--+--. .--+--.
  | Yes | |  No |
  '--+--' '--+--'
     |       |
     v       v
 .---+---. .--+--.
 | Save  | |Error|
 '-------' '-----'
```

### Connections with markers and diagonal arrows
```svgbob
  .---.        .---.
  | A |------->| B |
  '---'        '---'
    \            ^
     \           |
      *------->--+
      o
  "co-edit"
```
