# Bytefield

**API ID**: `bytefield` | **Output**: SVG only | **Best for**: Binary protocol field layouts, memory maps, register definitions

## Syntax

Clojure DSL (SCI interpreter — no Java/host interop).

### Global config (def)

```clojure
(def boxes-per-row 16)   ; columns per row (default: 16)
(def box-width 40)        ; box width in px
(def row-height 30)       ; row height in px
(def left-margin 1)       ; left margin in px
```

### Main functions

| Function | Description |
|---|---|
| `(draw-column-headers)` | Offset headers (hex 0-f). Call **before** the boxes |
| `(draw-column-headers {:labels [...]})` | Custom headers |
| `(draw-box label)` | Single box |
| `(draw-box label {:span N})` | Box spanning N columns |
| `(draw-boxes labels)` | Several identical boxes |
| `(draw-related-boxes labels)` | Grouped boxes (dotted inner borders) |
| `(draw-gap)` | Gap (entire row) |
| `(draw-gap "label")` | Gap with text |
| `(draw-bottom)` | Closes the bottom border after a gap |
| `(draw-padding n)` | Pads up to address n |

### draw-box options

```clojure
(draw-box "label" {
  :span 4                          ; columns occupied (default: 1)
  :fill "#e8f4f8"                  ; background color (CSS hex or name)
  :borders #{:left :right :top :bottom}  ; visible borders (default: all)
  :text-anchor "middle"            ; alignment: "start" "middle" "end"
  :height 40                       ; height override
})
```

`:borders` value = Clojure set. Examples:
- `#{:left :right :top}` — no bottom (before a gap)
- `#{:left :right :bottom}` — no top (after a gap)
- `#{}` — invisible (empty box)

### Predefined text styles (attr-spec vector)

```clojure
(draw-box "x" [:hex])     ; hex monospace, font-size 18
(draw-box "x" [:plain])   ; serif, font-size 18
(draw-box "x" [:math])    ; italic
(draw-box "x" [:bold])    ; bold
(draw-box "x" [:plain {:font-size 12}])  ; attribute merge
```

### Loops (standard Clojure)

```clojure
(doseq [v (range 8)] (draw-box v))
(draw-related-boxes (range 16))
```

## Gotchas

- `draw-column-headers` **must precede** the boxes — repositioning afterwards is impossible
- `:borders` = **set** `#{...}` not a vector `[...]`
- No Java interop in the DSL (limited SCI)
- `draw-gap` consumes an entire row — use `draw-bottom` to close
- Labels `nil` = empty box (no error)
- `boxes-per-row` must be defined **before** `draw-column-headers`

## Examples

### Network protocol (basic)

```bytefield
(def boxes-per-row 8)
(draw-column-headers)
(draw-box "Address" {:span 4})
(draw-box "Size" {:span 2})
(draw-box "Flags" {:span 2})
(draw-box "Payload" {:span 8 :borders #{:left :right :top}})
(draw-gap)
(draw-bottom)
```

### Frame with bits, colors and groups

```bytefield
(def boxes-per-row 16)
(draw-column-headers)
(draw-box "Version" {:span 1 :fill "#f9c74f"})
(draw-box "IHL" {:span 1 :fill "#f9c74f"})
(draw-box "DSCP" {:span 1})
(draw-box "ECN" {:span 1})
(draw-box "Total Length" {:span 4 :fill "#90e0ef"})
(draw-box "Identification" {:span 4})
(draw-box "Flags" {:span 1 :fill "#f9c74f"})
(draw-box "Fragment Offset" {:span 3})
(draw-box "TTL" {:span 2 :fill "#c77dff"})
(draw-box "Protocol" {:span 2 :fill "#c77dff"})
(draw-box "Header Checksum" {:span 4})
(draw-related-boxes ["Src IP" "Src IP" "Src IP" "Src IP"])
(draw-related-boxes ["Dst IP" "Dst IP" "Dst IP" "Dst IP"])
(draw-box "Options" {:span 12 :borders #{:left :right :top}})
(draw-gap "variable")
(draw-bottom)
```
