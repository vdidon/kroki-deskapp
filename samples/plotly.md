# Interactive Plotly engine

Plotly is a **"live"** engine rendered directly in the view (not a static SVG):
hover, zoom and pan all work. Two source forms.

## 1. Inline JSON spec

```plotly
{
  "data": [
    { "type": "box", "name": "JAN", "y": [1.02, 1.05, 1.08, 1.10, 1.13, 1.07, 1.09], "marker": { "color": "#1b9e77" } },
    { "type": "box", "name": "FEB", "y": [1.04, 1.06, 1.08, 1.10, 1.12, 1.085],     "marker": { "color": "#d95f02" } },
    { "type": "box", "name": "MAR", "y": [0.78, 0.81, 0.84, 0.87, 0.90],            "marker": { "color": "#7570b3" } }
  ],
  "layout": { "title": { "text": "Q1 — distribution of ratios r = M/Q (inline)" }, "yaxis": { "title": { "text": "ratio" } } }
}
```

## 2. External file via `src=`

Keeps the `.md` light: the spec lives in a `.json` next to the document.

```plotly src=figures/demo_scatter.json
```

## 3. Error handled gracefully

```plotly
{ "data": [ { "type": "box"
```
