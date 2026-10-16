# Vega and Vega-Lite

---

## Vega

**API ID**: `vega` | **Output**: SVG, PNG, JPEG | **Best for**: Complex custom visualizations, word clouds, geographic maps

### Syntax

Strict JSON (`$schema` required). Structure: `data` → `scales` → `axes/legends` → `marks` → `signals`.

**Marks** (12 types) : `rect`, `symbol`, `line`, `area`, `text`, `arc`, `rule`, `trail`, `path`, `shape`, `image`, `group`
- `group` = nested container (sub-plots)
- `shape` = path variant optimized for maps
- `trail` = line whose thickness varies with the data
- Each mark supports the `enter`, `update`, `exit` sets + optional `hover`

**Transforms** : `filter`, `formula`, `aggregate`, `bin`, `collect` (sort), `lookup`, `flatten`, `fold`, `pivot`, `window`, `wordcloud`, `treemap`, `force`, `geoshape`, `geopath`, `sequence`, `project`, `density`, `regression`, `loess`, `contour`, `crossfilter`, `resolvefilter`

**Scales** :
- Quantitative: `linear` (default), `log` (non-zero domain), `pow`, `sqrt`, `symlog`, `time`, `utc`
- Discrete: `ordinal`, `band` (continuous range split into bands), `point` (band with zero width)
- Discretizing: `quantile`, `quantize`, `threshold`, `bin-ordinal`

**Signals** : reactive variables re-evaluated on events. Language = restricted JS subset (no assignment, no loops, no `new`). Referenced directly by name in expressions.

**Data formats** : `values` (inline), `url` (remote file), `name` (reference to a named dataset)

### Example

```vega
{
  "$schema": "https://vega.github.io/schema/vega/v5.json",
  "width": 300, "height": 200, "padding": 5,
  "data": [{"name": "table", "values": [
    {"category": "A", "amount": 28},
    {"category": "B", "amount": 55},
    {"category": "C", "amount": 43}
  ]}],
  "scales": [
    {"name": "xscale", "type": "band", "domain": {"data": "table", "field": "category"}, "range": "width", "padding": 0.1},
    {"name": "yscale", "domain": {"data": "table", "field": "amount"}, "range": "height", "nice": true}
  ],
  "axes": [
    {"orient": "bottom", "scale": "xscale"},
    {"orient": "left", "scale": "yscale"}
  ],
  "marks": [{"type": "rect", "from": {"data": "table"},
    "encode": {"enter": {
      "x": {"scale": "xscale", "field": "category"},
      "width": {"scale": "xscale", "band": 1},
      "y": {"scale": "yscale", "field": "amount"},
      "y2": {"scale": "yscale", "value": 0},
      "fill": {"value": "steelblue"}
    }}}]
}
```

---

## Vega-Lite

**API ID**: `vegalite` | **Output**: SVG, PNG, JPEG | **Best for**: Standard charts with minimal JSON

### Syntax

`$schema` + `data` + `mark` + `encoding`. Smart defaults, auto-scaling, automatic axes.

**Primitive marks** : `bar`, `line`, `area`, `point`, `circle`, `square`, `rect`, `tick`, `arc`, `rule`, `text`, `geoshape`, `trail`

**Composite marks** (multi-layer macros) : `boxplot`, `errorband`, `errorbar`

**Mark options** (object or string) : `filled`, `color`, `opacity`, `strokeWidth`, `strokeDash`, `size`, `interpolate`, `point` (for line/area), `clip`, `tooltip`, `cursor`

**Encoding channels** :
- Position : `x`, `y`, `x2`, `y2`, `xError`, `yError`, `xOffset`, `yOffset`
- Polar: `theta`, `radius`, `theta2`, `radius2` (for `arc`)
- Geo: `longitude`, `latitude`
- Mark properties: `color`, `fill`, `stroke`, `opacity`, `fillOpacity`, `strokeOpacity`, `size`, `shape`, `angle`, `strokeDash`, `strokeWidth`
- Text/tooltip: `text`, `tooltip`
- Others: `detail` (group without a visual), `order` (stack/layer order), `href`, `facet`, `row`, `column`

**Data types** : `quantitative` (Q), `ordinal` (O), `nominal` (N), `temporal` (T), `geojson`

**Field definition** : `field`, `type`, `aggregate`, `bin`, `timeUnit`, `title`, `scale`, `axis`, `legend`, `sort`, `stack`, `condition`

**Aggregate** : `count`, `sum`, `mean`, `median`, `min`, `max`, `distinct`, `variance`, `stdev`, `q1`, `q3`, `ci0`, `ci1`

**TimeUnit** : `year`, `month`, `day`, `hours`, `minutes`, `yearmonth`, `yearmonthdate`, `monthdate`, `hoursminutes`, etc.

**Bin** : `true` | `{"maxbins": 20}` | `{"step": 10, "extent": [0, 100]}`

**Composition** :
- `layer: [spec1, spec2]` — superimpose (same data, unified scales)
- `hconcat` / `vconcat` / `concat` — juxtapose (independent scales by default)
- `facet: {field, type}` — trellis (data partitioning)
- `repeat: {row: [...], column: [...]}` — repeat for each field of an array

**Selections/Parameters** (v5) :
- `params: [{name, select: {type: "point"}}]` — discrete selection (click)
- `params: [{name, select: {type: "interval"}}]` — rectangular brush
- `resolve` in facet/repeat: `"global"` (single brush) or `"union"` (one per cell)

**Config** : global override of the defaults — `{"config": {"axis": {...}, "mark": {...}, "view": {...}, "legend": {...}}}`

### Example

```vegalite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": {"values": [
    {"a": "A", "b": 28}, {"a": "B", "b": 55}, {"a": "C", "b": 43},
    {"a": "D", "b": 91}, {"a": "E", "b": 81}, {"a": "F", "b": 53}
  ]},
  "mark": "bar",
  "encoding": {
    "x": {"field": "a", "type": "nominal", "axis": {"labelAngle": 0}},
    "y": {"field": "b", "type": "quantitative"}
  }
}
```

### Example — Layer (line + points)

```vegalite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "data": {"values": [
    {"x": 1, "y": 10}, {"x": 2, "y": 30}, {"x": 3, "y": 20}, {"x": 4, "y": 50}
  ]},
  "layer": [
    {"mark": "line", "encoding": {"x": {"field": "x", "type": "quantitative"}, "y": {"field": "y", "type": "quantitative"}}},
    {"mark": {"type": "point", "filled": true}, "encoding": {"x": {"field": "x", "type": "quantitative"}, "y": {"field": "y", "type": "quantitative"}}}
  ]
}
```

---

## Vega vs Vega-Lite

| Aspect | Vega | Vega-Lite |
|--------|------|-----------|
| Verbosity | High (everything explicit) | Low (smart defaults) |
| Control | Full (pixels, events, signals) | Partial (high-level abstraction) |
| Learning curve | Steep | Gentle |
| Composition | `group` marks | `layer`/`concat`/`facet`/`repeat` |
| Interactivity | Signals + event streams | Parameters + selections |
| Compilation | Final spec | Compiles to Vega |

---

## Gotchas

- **`$schema` required** in both — Kroki rejects the spec without it
- **Strict JSON**: no trailing commas, no comments
- **`band` vs `point` scale (Vega)** : use `band` for bars (auto width), `point` for scatter on a discrete axis
- **Log scale** : the domain must be strictly positive or strictly negative, never zero
- **Vega-Lite `mark` object vs string** : `"mark": "bar"` or `"mark": {"type": "bar", "color": "red"}` — both are valid
- **Encoding `type` required** in Vega-Lite unless `aggregate: "count"` (no `field`)
- **`layer` shares the scales** — if the ranges differ greatly, use `resolve: {"scale": {"y": "independent"}}`
- **`arc` (pie/donut)** requires a `theta` encoding + `view: {"stroke": null}` to remove the border
- **`facet` vs `row`/`column`** : `row`/`column` in `encoding` = shorthand; top-level `facet` = more control
- **Selections v5** : the old `selection` syntax is replaced by `params` with `select`
