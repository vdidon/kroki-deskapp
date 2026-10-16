# Pikchr

**API ID**: `pikchr` | **Output**: SVG only | **Best for**: Syntax diagrams, railroad diagrams, technical drawings, git graphs

## Syntax

### Objects
| Block | Line/Path | Others |
|-------|-----------|--------|
| `box` `circle` `ellipse` `oval` | `arrow` `line` `spline` | `text` |
| `cylinder` `file` `diamond` `dot` | `arc` (quadratic Bézier) | `move` (invisible spacing) |

### Common attributes
```
width/wid  height/ht  radius/rad  diameter
color fill thickness thick thin invisible/invis
dashed dotted fit same behind
```
- `fit` : resizes the object around its text
- `same as LABEL` : copies the settings of a previous object
- `behind LABEL` : draws below another object
- `close` : closes a multi-segment path into a polygon

### Positioning
```pikchr
box at (1cm, 2cm)                   # absolute position
box with .w at previous.e           # .w anchor on the previous object's .e anchor
circle right of last box            # directional relative
arrow from B1.s to B2.n chop        # chop = trims at object edges
```
Anchors: `.n .ne .e .se .s .sw .w .nw .c .start .end`

Relative: `right of` `left of` `above` `below` `N cm right of X`

Layout direction: `right` (default) | `down` | `left` | `up`

### Multi-segment paths
```pikchr
line from A.e then right 1cm then down until even with B then to B.w
arrow go heading 45 1cm
```

### Labels and text
```pikchr
B1: box "Label" "line2"             # label (UPPERCASE) + displayed text
box "text" above ljust bold italic  # placement: above/below/ljust/rjust
box "text" small mono               # size: small/big | font: mono
line "label" aligned                # aligned = rotates along the line
```

### Variables and expressions
```pikchr
$gap = 0.3cm
boxwid = 1.5in; boxht = 0.5in      # system variables
box width 150%                      # percentage
box thickness 2*(thickness)         # reading a system variable: parentheses required
```
System variables: `boxwid` `boxht` `circlerad` `ellipsewid` `ellipseht`
`linewid` `lineht` `arrowwid` `arrowht` `thickness` `charwid` `charht`

Supported units: `cm` `mm` `in` `px` `pt` `pc` (attached to the number: `1.5cm` not `1.5 cm`)

### References
```pikchr
previous       last box       1st circle       3rd last oval
B1.e           2nd vertex of last arrow
```

### Containers
```pikchr
[
  box "A"; arrow; box "B"
] wid 3cm ht 2cm
```

## Gotchas

- **Parentheses required** to read system variables: `2*(thickness)` not `2*thickness`
- **Units attached** to the number: `1cm` not `1 cm`
- **No for/if** (unlike PIC) — loops removed for safety
- **Arc = Bézier** quadratic, not a true geometric arc
- **Block variables `[...]`**: values modified inside persist after the block closes
- **Forward references** impossible: an object can only reference objects already defined
- **Text size** is estimated (no access to the rendering engine): adjust `charwid`/`charht` if needed
- **Object is fixed** at the line break/semicolon: cannot be modified afterwards

## Examples

### Compilation pipeline
```pikchr
box "Source" fit
arrow
box "Lexer" fit
arrow
box "Parser" fit
arrow
box "AST" fit
arrow
box "CodeGen" fit
arrow
box "Output" fit
```

### Commit graph (branches)
```pikchr
circle "C0" fit; circlerad = previous.radius
arrow; circle "C1"
arrow; circle "C2"
arrow; circle "C3"
circle "B1" at dist(C1,C2) heading 60 from C1
arrow from C1 to B1 chop
arrow from B1 to B2 chop
```

### Diagram with container and colors
```pikchr
$m = 0.2cm
down
A: box "Input" fit fill 0xd0e8ff
arrow
B: box "Process" fit fill 0xffe4c4 thickness 2px
arrow
C: box "Output" fit fill 0xd0ffd8
frame: box wid (B.wid + 2*$m) ht (A.n.y - C.s.y + 2*$m) \
       at B fill none color gray behind A
```
