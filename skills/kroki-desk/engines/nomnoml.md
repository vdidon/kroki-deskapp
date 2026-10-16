# Nomnoml

**API ID**: `nomnoml` | **Output**: SVG | **Best for**: UML class/state/usecase diagrams, compact syntax

## Syntax

### Nodes & Compartments
- Basic: `[Name]` · With compartments: `[Name|fields|methods]`
- Classifier: `[<type> Name]` e.g. `[<abstract> Animal]`
- Unique ID (duplicate labels): `[<actor id=a> User]`
- Nested: `[Parent|[Child1]->[Child2]]`
- Comments: `// text` (start of line only)

### Classifiers
`abstract` `instance` `reference` · `note` `label` `hidden` · `package` `frame` · `database` `pipe` `table` · `start` `end` `state` `choice` `sync` · `input` `sender` `receiver` `transceiver` · `actor` `usecase` · `lollipop` `socket`

### Relations
| Syntax | Meaning |
|---|---|
| `->` / `<->` | Directed / bidirectional association |
| `-->` | Dependency |
| `-:>` | Generalization (inheritance) |
| `--:>` | Realization (interface) |
| `+-` / `+->` | Composition |
| `o-` / `o->` | Aggregation |
| `-o)` | Ball-and-socket |
| `--` | Note link |
| `-/-` | Hidden relation |

Multiplicity before the relation: `[User] 1 --> * [Order]`

### Directives
| Directive | Values |
|---|---|
| `#direction` | `down` \| `right` |
| `#edges` | `hard` \| `rounded` |
| `#ranker` | `network-simplex` \| `tight-tree` \| `longest-path` |
| `#acyclicer` | `greedy` |
| `#spacing` `#padding` `#gutter` `#edgeMargin` | number |
| `#fontSize` `#lineWidth` `#arrowSize` `#bendSize` `#gravity` `#zoom` | number |
| `#font` | font name |
| `#fill` | CSS color(s) (e.g. `#eee; #fff`) |
| `#stroke` `#background` | CSS color |
| `#fillArrows` | `false` |
| `#leading` | number (line spacing) |
| `#title` | text |

### Custom styles
Define: `#.styleName: dashed fill=#fdf6e3 stroke=#657b83 align=left`
Apply: `[<styleName> MyNode]`
Text modifiers: `bold` `italic` `underline` `center` `left`
Visuals: `visual=actor|database|ellipse|rhomb|roundrect|...`

## Gotchas
- `-->` = dependency (not composition) · `-:>` = inheritance (not `->:`)
- Field separator inside a compartment: `;` (not comma or newline)
- `//` comments only at **start of line**
- `#import` is not supported on the Kroki side
- `#fill` accepts several colors separated by `;` (gradient across nesting levels)
- Nodes with the same label are merged → use `id=` to tell them apart

## Examples

```nomnoml
[User|name: String;email: String|login();logout()]
[Order|id: Int;total: Float|validate()]
[Product|name: String;price: Float]

[User] 1 --> * [Order]
[Order] * --> * [Product]
```

```nomnoml
#direction: right
#edges: rounded
#fill: #dae8fc; #fff

[<start> s] -> [<choice> logged?]
[logged?] -> [Dashboard] yes
[logged?] --> [<state> Login] no
[Login] -> [<end> e]
[Dashboard] -> [<end> e]
```
