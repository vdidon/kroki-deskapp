# Excalidraw

**API ID**: `excalidraw` | **Output**: SVG only | **Best for**: Whiteboard-style hand-drawn diagrams

## Syntax

### Top-level structure
```json
{ "type": "excalidraw", "version": 2, "source": "https://excalidraw.com",
  "elements": [], "appState": { "viewBackgroundColor": "#ffffff" } }
```

### Element types
`rectangle` | `ellipse` | `diamond` | `line` | `arrow` | `text` | `freedraw` | `image` | `frame`

### Universal required fields
`type`, `id` (unique string), `x`, `y`, `width`, `height`

### Style properties (with defaults)
| Property | Values | Default |
|---|---|---|
| `strokeColor` | hex color | `"#1e1e1e"` |
| `backgroundColor` | hex color | `"transparent"` |
| `fillStyle` | `"solid"` \| `"hachure"` \| `"cross-hatch"` | `"solid"` |
| `strokeWidth` | `1` \| `2` \| `4` | `2` |
| `strokeStyle` | `"solid"` \| `"dashed"` \| `"dotted"` | `"solid"` |
| `roughness` | `0` (sharp) \| `1` (hand-drawn) \| `2` (very rough) | `1` |
| `opacity` | `0`..`100` | `100` |
| `angle` | radians | `0` |

### Roundness (rounded corners)
```json
"roundness": { "type": 3 }
```

### Text properties
| Property | Values |
|---|---|
| `fontFamily` | `1`=Excalifont/Virgil (hand-drawn) \| `2`=Helvetica \| `3`=Cascadia (code) |
| `fontSize` | number, min 16 recommended |
| `textAlign` | `"left"` \| `"center"` \| `"right"` |

**Positioning**: `x`/`y` = left edge (not centered). Centering formula: `x = cx - (text.length * fontSize * 0.5) / 2`

**Alternative**: use `containerId` to auto-center inside a container.

### Arrows — points and bindings
```json
{
  "type": "arrow", "id": "arr1", "x": 200, "y": 80, "width": 100, "height": 0,
  "points": [[0,0],[100,0]],
  "startArrowhead": null,
  "endArrowhead": "arrow",
  "startBinding": { "elementId": "rect1", "focus": 0, "gap": 5 },
  "endBinding":   { "elementId": "rect2", "focus": 0, "gap": 5 }
}
```
`endArrowhead`/`startArrowhead`: `"arrow"` | `"bar"` | `"dot"` | `"triangle"` | `null`

`points` = `[dx, dy]` offsets from the element's `x`/`y`.

### Label inline (shapes + arrows)
```json
{ "type": "rectangle", "x": 50, "y": 50, "width": 150, "height": 60,
  "label": { "text": "Service A", "fontSize": 16 } }
```
Auto-centered, container resized automatically. Avoids manual text position calculation.

### Groups
```json
"groupIds": ["group1"]
```
Several elements with the same `groupIds` are grouped together.

### Z-order
First element in the array = background. Last = foreground.

## Gotchas

- **Unique IDs required**: never reuse an ID, even after deletion
- **`boundElementIds`** : on shapes, list the IDs of the arrows connected to them (bidirectional consistency)
- **Arrow `points`**: coordinates relative to `x`/`y`, not absolute
- **Text is not centered**: `x`/`y` = left edge; use inline `label` to avoid the calculation
- **fontSize min 16px** for readability (rendered SVG)
- **`version` and `versionNonce`** : include for collaboration (otherwise optional)

## Example

```excalidraw
{
  "type": "excalidraw",
  "version": 2,
  "source": "https://excalidraw.com",
  "elements": [
    {
      "type": "rectangle",
      "id": "rect1",
      "x": 50, "y": 50, "width": 150, "height": 60,
      "strokeColor": "#1e1e1e", "backgroundColor": "#a5d8ff",
      "fillStyle": "solid", "strokeWidth": 2, "roughness": 1,
      "roundness": { "type": 3 },
      "label": { "text": "Service A", "fontSize": 16, "fontFamily": 1 }
    },
    {
      "type": "rectangle",
      "id": "rect2",
      "x": 300, "y": 50, "width": 150, "height": 60,
      "strokeColor": "#1e1e1e", "backgroundColor": "#b2f2bb",
      "fillStyle": "hachure", "strokeWidth": 2, "roughness": 1,
      "boundElementIds": ["arr1"],
      "label": { "text": "Service B", "fontSize": 16, "fontFamily": 1 }
    },
    {
      "type": "arrow",
      "id": "arr1",
      "x": 200, "y": 80, "width": 100, "height": 0,
      "strokeColor": "#1e1e1e", "strokeWidth": 2, "roughness": 1,
      "points": [[0,0],[100,0]],
      "startArrowhead": null, "endArrowhead": "arrow",
      "startBinding": { "elementId": "rect1", "focus": 0, "gap": 5 },
      "endBinding":   { "elementId": "rect2", "focus": 0, "gap": 5 }
    }
  ],
  "appState": { "viewBackgroundColor": "#ffffff" }
}
```
