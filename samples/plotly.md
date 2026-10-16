# Moteur Plotly interactif

Plotly est un moteur **« live »** rendu directement dans la vue (pas un SVG figé) :
survol, zoom, pan fonctionnent. Deux formes de source.

## 1. Spec JSON inline

```plotly
{
  "data": [
    { "type": "box", "name": "JAN", "y": [1.02, 1.05, 1.08, 1.10, 1.13, 1.07, 1.09], "marker": { "color": "#1b9e77" } },
    { "type": "box", "name": "FEB", "y": [1.04, 1.06, 1.08, 1.10, 1.12, 1.085],     "marker": { "color": "#d95f02" } },
    { "type": "box", "name": "MAR", "y": [0.78, 0.81, 0.84, 0.87, 0.90],            "marker": { "color": "#7570b3" } }
  ],
  "layout": { "title": { "text": "Q1 — distribution des ratios r = M/Q (inline)" }, "yaxis": { "title": { "text": "ratio" } } }
}
```

## 2. Fichier externe via `src=`

Garde le `.md` léger : la spec vit dans un `.json` à côté du document.

```plotly src=figures/demo_scatter.json
```

## 3. Erreur gérée proprement

```plotly
{ "data": [ { "type": "box"
```
