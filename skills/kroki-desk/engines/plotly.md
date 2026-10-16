# Plotly (interactive — Kroki Desk only)

**Fence ID**: `plotly` | **Output**: live interactive HTML (hover, zoom, pan) | **Best for**: data exploration where interactivity matters

> **NOT a Kroki engine.** There is no `kroki.io/plotly/svg` endpoint. Plotly is a
> Kroki Desk-specific "live" engine: the ` ```plotly ` block bypasses the Kroki/SVG
> pipeline and renders in the main webview via Plotly.js. In any **other** viewer
> (GitHub, generic Kroki server, VS Code preview) the block renders **nothing useful**.
> Only choose Plotly when the target renderer is **Kroki Desk** and interactivity is
> the point. For static, portable charts use **Vega-Lite / Vega** instead.

---

## Two input forms

A `plotly` block carries a **Plotly figure JSON** — `{ "data": [...], "layout": {...}, "config": {...} }` — either:

**1. Inline** (spec in the fence):

````markdown
```plotly
{ "data": [{ "type": "scatter", "x": [1,2,3], "y": [4,1,8], "mode": "lines+markers" }],
  "layout": { "title": "Demo" } }
```
````

**2. External file** via `src=` (the fence body stays empty):

````markdown
```plotly src=figures/revenue.json
```
````

`src=` is read by the backend command `read_data_file`, **confined to the document
folder**: relative path only, `.json` only, no absolute path, no `..`/symlink escape.

---

## Figure structure

- **`data`** — array of **traces**. Each trace is an object with a `type` and its
  data arrays. Common types: `scatter` (+ `mode`: `lines`/`markers`/`lines+markers`),
  `bar`, `box`, `histogram`, `histogram2d`, `heatmap`, `pie`, `violin`, `scatter3d`,
  `surface`, `candlestick`, `choropleth`.
- **`layout`** — titles, axes (`xaxis`/`yaxis`), `barmode`, `legend`, `annotations`,
  `shapes`, `grid` (for subplots via `xaxis2`/`yaxis2` + `domain`).
- **`config`** *(optional)* — `{ "scrollZoom": true, "staticPlot": false, ... }`.

---

## Kroki Desk overrides the theme (don't fight it)

`renderPlotly` rewrites part of `layout`/`config` to fit the document theme. These win
over the spec, so setting them is pointless:

| Field | Forced to | Consequence |
|-------|-----------|-------------|
| `paper_bgcolor`, `plot_bgcolor` | `rgba(0,0,0,0)` | background is **always transparent** — your bg colors are ignored |
| `layout.width` | *deleted* + `autosize:true` | width is **fluid** (fills the column); setting `width` does nothing |
| `config.responsive` | `true` | always responsive |

What you **can** control: `layout.height` (respected; defaults to **420** if unset),
`layout.font` (your `font` wins, only the default text color is supplied), trace colors,
`config.displaylogo` (defaults to `false`).

---

## Portability: pair with a PNG fallback (same stem)

Because a raw `plotly` block is invisible outside Kroki Desk, a report generator should
emit a **static image immediately before** the block, with the **same file stem**:

````markdown
![Revenue 2024](figures/png/revenue.png)

```plotly src=figures/revenue.json
```
````

- `revenue.png` ↔ `revenue.json` → **same stem** `revenue`. That stem match is the link.
- **Outside Kroki Desk** (GitHub, etc.): the PNG shows; the `plotly` block is inert.
- **Inside Kroki Desk**: once the interactive chart renders, `hidePairedFallbackImage`
  hides the paired PNG so the figure isn't shown twice. If Plotly **fails**, the PNG
  stays visible — a genuine fallback. (Kroki Desk ≥ 1.4.1.)

Without the fallback the chart is simply absent in any non-Kroki-Desk viewer.

---

## Example — inline grouped bar chart

```plotly
{
  "data": [
    { "type": "bar", "name": "2023", "x": ["Q1","Q2","Q3","Q4"], "y": [20,14,23,25] },
    { "type": "bar", "name": "2024", "x": ["Q1","Q2","Q3","Q4"], "y": [24,18,21,30] }
  ],
  "layout": { "title": "Revenue by quarter", "barmode": "group", "height": 380,
    "yaxis": { "title": "M€" } }
}
```

## Example — box plot (subplot grid via src=)

````markdown
![Ratios by quarter](figures/png/ratios.png)

```plotly src=figures/ratios.json
```
````

`figures/ratios.json` holds the full `{ "data": [...box traces...], "layout": {...grid...} }`.

---

## Gotchas

- **No Kroki endpoint** — never POST a `plotly` spec to `kroki.io` or `127.0.0.1:8442`;
  it 404s. The HTTP validation loop used for real engines does **not** apply (see SKILL.md).
- **Kroki Desk only** — in any other Markdown renderer the block is dead. Always pair
  with a PNG fallback when the document may be read elsewhere.
- **Strict JSON** — no trailing commas, no comments, no `NaN`/`Infinity` literals
  (use `null` for gaps).
- **`src=` is sandboxed** — relative path inside the doc folder, `.json` only; absolute
  paths and `..` escapes are rejected by `read_data_file`.
- **Background/width are overridden** — set `height`, not `width`; don't set
  `paper_bgcolor`/`plot_bgcolor` (forced transparent).
- **First figure is slower** — the ~4.8 MB Plotly bundle is lazy-loaded on the first
  `plotly` block of the session, then cached.
- **Never emit standalone CDN HTML** — a `cdn.plot.ly` page is broken inside the app by
  its strict CSP (no `https:` in `script-src`) and dead offline. For a large catalogue of
  figures *not* referenced from the `.md`, ship a local-bundle HTML set plus an
  `index.html` (browser-only) instead of blocks.
- **plotly.py ↔ plotly.js** — the app bundles plotly.js **3.6.0**; keep the plotly.py
  version that writes the JSON compatible with it.
