# UMlet

> ⛔ **Not embedded in Kroki Desk.** This engine is recognised by Kroki upstream but
> is *not* compiled into the app: it renders only through an external Kroki server
> configured in the settings. Without one the block shows an error whatever the
> syntax — and the local API answers **HTTP 400**, same as a syntax error, so do not
> "fix" a source that was never going to render here. Pick an embedded engine
> (`d2`, `graphviz`, `mermaid`…) unless the user has a server, and say so in one line.

**API ID**: `umlet` | **Output**: SVG, PNG, JPEG | **Best for**: Traditional UML with pixel-precise positioning

## Syntax

UXF format (XML). Overall structure:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<diagram program="umlet" version="14.3">
  <zoom_level>10</zoom_level>
  <!-- elements -->
</diagram>
```

### Main elements (`<id>`)

| ID | Description |
|----|-------------|
| `UMLClass` | UML class (sections separated by `--`) |
| `UMLInterface` | Interface (with `<<interface>>`) |
| `UMLUseCase` | Use case (oval) |
| `UMLActor` | Actor (stick figure) |
| `UMLState` | State (state machine) |
| `UMLNote` | Note / comment |
| `UMLPackage` | Container package |
| `UMLGeneric` | Generic shape (with `symbol=`) |
| `UMLSequenceAllInOne` | Full sequence diagram |
| `UMLHierarchy` | Tabular hierarchy |
| `Relation` | Link between elements |
| `Text` | Free text (`style=wordwrap`) |

### Element structure

```xml
<element>
  <id>UMLClass</id>
  <coordinates><x>10</x><y>10</y><w>160</w><h>80</h></coordinates>
  <panel_attributes>ClassName
--
-id: Long
+getName(): String</panel_attributes>
  <additional_attributes/>
</element>
```

### panel_attributes — common syntax

- Sections: `--` (horizontal separator)
- Stereotype: `<<Interface>>` or `<<abstract>>`
- Visibility: `+` public · `-` private · `#` protected
- Text style: `_italic_` · `*bold*`
- Colors: `bg=yellow` · `fg=red`
- Alignment: `halign=left` · `valign=center`
- Free key/value properties: `{abstract}`

### Relations — `lt=` line types

| `lt=` | Type |
|-------|------|
| `lt=->` | Directed association |
| `lt=-` | Simple association |
| `lt=<-` | Aggregation |
| `lt=<<-` | Composition |
| `lt=<.-` | Dependency |
| `lt=<.>` | Bidirectional dependency |
| `lt=<.` | Realization (interface) |
| `lt=<..` | Dotted association |
| `lt=.>` | Extend (use case) |
| `lt=->>` | Include (use case) |

`additional_attributes` = path points: `x1;y1;x2;y2` (relative to the relation's bounding box).

Connection by **spatial proximity**: a relation endpoint within 10px of an element's edge snaps to it automatically.

Multiplicity: `m1=1` · `m2=*` in the Relation's `panel_attributes`.

## Gotchas

- **No explicit links**: relations connect by proximity, not by ID. The coordinates must touch.
- **`additional_attributes` required** for `Relation` (even if empty → `10;10;100;10`). Without it, the arrow does not appear.
- **`zoom_level`** affects the final rendering; `10` = 100%, recommended value.
- **Deprecated elements**: old classes used `<type>com.umlet.element.Class</type>`; Kroki only accepts the modern syntax with `<id>`.
- **Custom Elements** (compiled Java) are not supported in Kroki; use `UMLGeneric` with `symbol=` instead.
- **Encoding**: via POST the raw XML works; via GET it must be deflate + base64.
- **`w`/`h` too small** = text cut off without warning.

## Examples

### Class diagram

```umlet
<?xml version="1.0" encoding="UTF-8"?>
<diagram program="umlet" version="14.3">
  <zoom_level>10</zoom_level>
  <element>
    <id>UMLClass</id>
    <coordinates><x>10</x><y>10</y><w>160</w><h>80</h></coordinates>
    <panel_attributes>User
--
-id: Long
-name: String
--
+login(): void</panel_attributes>
    <additional_attributes/>
  </element>
  <element>
    <id>UMLClass</id>
    <coordinates><x>240</x><y>10</y><w>160</w><h>80</h></coordinates>
    <panel_attributes>Order
--
-id: Int
-status: String
--
+validate(): boolean</panel_attributes>
    <additional_attributes/>
  </element>
  <element>
    <id>Relation</id>
    <coordinates><x>170</x><y>40</y><w>90</w><h>30</h></coordinates>
    <panel_attributes>lt=->
m1=1
m2=*</panel_attributes>
    <additional_attributes>10;10;70;10</additional_attributes>
  </element>
</diagram>
```

### Use case diagram

```umlet
<?xml version="1.0" encoding="UTF-8"?>
<diagram program="umlet" version="14.3">
  <zoom_level>10</zoom_level>
  <element>
    <id>UMLActor</id>
    <coordinates><x>20</x><y>60</y><w>40</w><h>60</h></coordinates>
    <panel_attributes>Client</panel_attributes>
    <additional_attributes/>
  </element>
  <element>
    <id>UMLUseCase</id>
    <coordinates><x>120</x><y>50</y><w>140</w><h>50</h></coordinates>
    <panel_attributes>Place order</panel_attributes>
    <additional_attributes/>
  </element>
  <element>
    <id>UMLUseCase</id>
    <coordinates><x>120</x><y>130</y><w>140</w><h>50</h></coordinates>
    <panel_attributes>Pay</panel_attributes>
    <additional_attributes/>
  </element>
  <element>
    <id>Relation</id>
    <coordinates><x>60</x><y>75</y><w>80</w><h>30</h></coordinates>
    <panel_attributes>lt=-</panel_attributes>
    <additional_attributes>10;10;60;10</additional_attributes>
  </element>
  <element>
    <id>Relation</id>
    <coordinates><x>190</x><y>90</y><w>30</w><h>60</h></coordinates>
    <panel_attributes>lt=.>
<<include>></panel_attributes>
    <additional_attributes>10;10;10;40</additional_attributes>
  </element>
</diagram>
```
