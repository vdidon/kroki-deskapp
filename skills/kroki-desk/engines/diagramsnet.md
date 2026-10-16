# diagrams.net (draw.io)

> ⛔ **Not embedded in Kroki Desk.** This engine is recognised by Kroki upstream but
> is *not* compiled into the app: it renders only through an external Kroki server
> configured in the settings. Without one the block shows an error whatever the
> syntax — and the local API answers **HTTP 400**, same as a syntax error, so do not
> "fix" a source that was never going to render here. Pick an embedded engine
> (`d2`, `graphviz`, `mermaid`…) unless the user has a server, and say so in one line.

> Note: `diagramsnet` is doubly unavailable — experimental upstream *and* absent from
> the app. For a draw.io-flavoured sketch, `excalidraw` (embedded) is the closer match.

**API ID**: `diagramsnet` | **Output**: SVG/PNG | **Status**: Experimental (separate service required)

## XML structure

```
mxfile > diagram > mxGraphModel > root > mxCell[]
```

**Mandatory cells** (always present):
- `id="0"` : model root, no parent
- `id="1" parent="0"` : default layer
- Actual content: `parent="1"` (3rd generation minimum)

## mxCell — Attributes

| Attribute | Role |
|----------|------|
| `id` | Unique identifier (string) — required |
| `value` | Text displayed in the shape |
| `style` | Style string `key=val;key=val;` |
| `vertex="1"` | Node/shape |
| `edge="1"` | Connector |
| `source` / `target` | IDs of the connected cells (edge only) |
| `parent` | ID of the parent cell |

**mxGeometry** (child of mxCell) :
- Vertex : `x y width height as="geometry"`
- Edge : `relative="1" as="geometry"` (+ `Array` for intermediate points)

## Common styles

```
# Basic shape
rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;

# Named shapes
shape=rhombus          # diamond
shape=cylinder3        # cylinder (DB)
shape=mxgraph.aws4.resourceIcon   # stencil AWS

# Texte
fontColor=#000000;fontSize=12;fontStyle=1   (1=bold 2=italic 4=underline)

# Connectors
edgeStyle=orthogonalEdgeStyle;rounded=0;exitX=1;exitY=0.5;entryX=0;entryY=0.5;
edgeStyle=elbowEdgeStyle;
edgeStyle=entityRelationEdgeStyle;

# Special colors
fillColor=none         # transparent
strokeColor=none       # no border
fillColor=#f5f5f5;strokeColor=#666666;fontColor=#333333;   # neutral gray
```

**Frequent style properties**:
`rounded` `arcSize` `whiteSpace=wrap` `html=1` `shadow` `sketch` `opacity`
`strokeWidth` `strokeOpacity` `fillColor` `strokeColor` `fontColor` `fontSize`
`align` (left|center|right) `verticalAlign` (top|middle|bottom)
`perimeter` `perimeterSpacing` `gradientColor` `gradientDirection`

## Gotchas

- **Missing IDs**: id="0" and id="1" are required, otherwise the rendering breaks
- **parent="1"** : all shapes/edges must have `parent="1"` (or a sub-group)
- **edge without geometry**: always add `<mxGeometry relative="1" as="geometry"/>`
- **Compression**: the native .drawio format compresses the XML (deflate+base64) — for Kroki, raw XML inside `<diagram>`
- **html=1** : required for line breaks in `value` via `<br>`
- **style string**: ending with `;` recommended, order does not matter
- **External stencils** (shape=mxgraph.*): depend on the Kroki service configuration
- **Separate service**: Kroki requires `yuzutech/kroki-diagramsnet` (Docker) — not included by default

## Example

```diagramsnet
<?xml version="1.0" encoding="UTF-8"?>
<mxfile>
  <diagram name="Page-1">
    <mxGraphModel dx="1034" dy="546" grid="1" gridSize="10" scale="1">
      <root>
        <mxCell id="0"/>
        <mxCell id="1" parent="0"/>
        <!-- Nodes -->
        <mxCell id="2" value="Client" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
          <mxGeometry x="80" y="100" width="120" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="3" value="Server" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;" vertex="1" parent="1">
          <mxGeometry x="340" y="100" width="120" height="60" as="geometry"/>
        </mxCell>
        <mxCell id="4" value="Data&lt;br&gt;base" style="shape=cylinder3;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d6b656;" vertex="1" parent="1">
          <mxGeometry x="340" y="220" width="120" height="60" as="geometry"/>
        </mxCell>
        <!-- Edges -->
        <mxCell id="5" value="HTTP" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" source="2" target="3" parent="1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
        <mxCell id="6" value="SQL" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" source="3" target="4" parent="1">
          <mxGeometry relative="1" as="geometry"/>
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>
```
