# Ditaa

> ☕ **Requires a JRE/JDK on the machine.** Kroki Desk embeds the jar but shells out
> to `java`; with no Java installed the block errors out (the app's message: "nécessite Java, qui n'a pas
> été trouvé sur ce poste" — requires Java, which was not found on this machine). Check with `java -version` — `/v1/health` lists this type
> even when Java is missing. Fallback without Java: `mermaid` or `d2`.

**API ID**: `ditaa` | **Output**: SVG, PNG | **Best for**: Converting ASCII art into clean diagrams

## Syntax

### Boxes and corners
```
+--+   standard rectangle     /--+   rounded top-left corner
|  |                           |  |
+--+                           +--/   rounded bottom-right corner
```
Rounded corners: `/` (top-left, bottom-right) and `\` (top-right, bottom-left)

### Lines and arrows
- Horizontal: `---` · Vertical: `|` · Diagonal: `/` `\`
- Arrows: `->` `<-` `<->` (automatic direction detection)
- Horizontal dashes: `=` · Vertical dashes: `:`

### Shape tags (in `{}` inside a box)
| Tag | Rendering |
|-----|-------|
| `{d}` | Document (folded corner) |
| `{s}` | Storage / database |
| `{io}` | Input/Output (parallelogram) |
| `{o}` | Ellipse |
| `{mo}` | Manual Operation (inverted trapezoid) |
| `{c}` | Decision / diamond |
| `{tr}` | Trapezoid |

### Colors (inside closed shapes only)
Named codes: `cRED` `cBLU` `cGRE` `cYEL` `cPNK` `cBLK`
Hex RGB: `cXXX` where XXX = 3 hex digits (e.g. `c0FF` = cyan)
Text color adapts automatically (white on dark backgrounds).

### Special markers
- `*`: connection point (experimental, not at end of line)
- ` o Text`: bullet point (space before and after the `o`)

### Internal separators
A line of `=` or `:` inside a box creates a visual separation.

## Kroki options

Passed as query param, header or `diagram_options` JSON:

| Option | Effect |
|--------|-------|
| `no-antialias` | Disables antialiasing |
| `no-shadows` | Removes drop shadows |
| `round-corners` | Rounds all corners globally |
| `no-separation` | Removes the separation between adjacent shapes |
| `scale` | Size factor (e.g. `2.0`) |
| `tabs` | Tab size in spaces (default: 8) |
| `fixed-slope` | Fixed slope for parallelograms |
| `background` | Background color, 6- or 8-digit hex |
| `transparent` | Transparent background |

## Gotchas

- Colors only in **closed** shapes — outside a box = ignored
- Tabs=8 by default → prefer spaces in sources
- Alignment is critical: each line must have the right width in ASCII
- `{c}` = diamond (choice), not color — colors are `cXXX` without braces
- Diagonal arrows not supported
- `no-separation` can visually merge adjacent boxes

## Examples

3-tier architecture:
```ditaa
+--------+   +--------+   /--------\
|        |   |        |   |        |
| Client +-->| Server +-->|   DB   |
|  {io}  |   |        |   |  {s}   |
+--------+   +--------+   \--------/
    ^                          |
    |       +--------+         |
    +-------+ Cache  |<--------+
            | {s}    |
            | cYEL   |
            +--------+
```

Pipeline with statuses:
```ditaa
/----------\   +----------+   +----------+
|  Source  |   |          |   | {d}      |
|  {io}    +-->| Process  +-->| Report   |
\----------/   |  cGRE    |   | cBLU     |
               +----------+   +----------+
                    |
               +----+----+
               | Error   |
               | {c} cRED|
               +---------+
```
