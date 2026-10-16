# C4 PlantUML

> ☕ **Requires a JRE/JDK on the machine.** Kroki Desk embeds the jar but shells out
> to `java`; with no Java installed the block errors out ("nécessite Java, qui n'a pas
> été trouvé sur ce poste" — "requires Java, which was not found on this machine"). Check with `java -version` — `/v1/health` lists this type
> even when Java is missing. Fallback without Java: `mermaid` or `d2`.

**API ID**: `c4plantuml` | **Output**: SVG, PNG, PDF, TXT | **Best for**: C4 software architecture (Context → Container → Component → Deployment)

## Includes per level

```
!include <C4/C4_Context>      ' Level 1 – Context
!include <C4/C4_Container>    ' Level 2 – Container (includes Context)
!include <C4/C4_Component>    ' Level 3 – Component (includes Container)
!include <C4/C4_Deployment>   ' Level 4 – Deployment
!include <C4/C4_Dynamic>      ' C4 sequence diagrams
```

With Kroki: use `<C4/...>` (local bundled stdlib). Do not use `raw.githubusercontent.com` URLs — Kroki disables remote includes.

## Macros per level

### Level 1 – Context (`C4_Context`)
```
Person(alias, label, ?descr, ?sprite, ?tags, ?link)
Person_Ext(alias, label, ?descr, ...)
System(alias, label, ?descr, ?sprite, ?tags, ?link)
System_Ext(alias, label, ?descr, ...)
SystemDb(alias, label, ?descr, ...)       ' database
SystemQueue(alias, label, ?descr, ...)    ' message queue
```

### Level 2 – Container (`C4_Container`)
```
Container(alias, label, technology, ?descr, ?sprite, ?tags, ?link)
ContainerDb(alias, label, technology, ?descr, ...)
ContainerQueue(alias, label, technology, ?descr, ...)
Container_Boundary(alias, label) { ... }
```

### Level 3 – Component (`C4_Component`)
```
Component(alias, label, technology, ?descr, ?sprite, ?tags, ?link)
ComponentDb(alias, label, technology, ?descr, ...)
ComponentQueue(alias, label, technology, ?descr, ...)
```

### Level 4 – Deployment (`C4_Deployment`)
```
Deployment_Node(alias, label, ?type, ?descr, ?sprite, ?tags, ?link)
Node(alias, label, ?type, ?descr, ...)    ' alias of Deployment_Node
Container_Instance(alias, container, ?instanceNum, ?descr, ...)
```

### Relations
```
Rel(from, to, label, ?techn, ?tags, ?link)
Rel_D(from, to, label, ?techn)   ' Down
Rel_U(from, to, label, ?techn)   ' Up
Rel_L(from, to, label, ?techn)   ' Left
Rel_R(from, to, label, ?techn)   ' Right
Rel_Back(from, to, label, ...)   ' reversed arrow
BiRel(from, to, label, ?techn)   ' bidirectional
```

### Boundaries
```
Boundary(alias, label, ?type, ?tags, ?link, ?descr) { ... }
System_Boundary(alias, label) { ... }
Enterprise_Boundary(alias, label) { ... }
```

## Layout helpers
```
LAYOUT_WITH_LEGEND()        ' automatic legend
LAYOUT_LANDSCAPE()          ' landscape orientation
LAYOUT_AS_SKETCH()          ' sketch style
Lay_R(from, to)             ' forces relative positioning
Lay_D(from, to)
```

## Sprites / icons
```
!include <tupadr3/common>
!include <tupadr3/devicons/postgresql>
Container(db, "DB", "PostgreSQL", $sprite="postgresql")
```

## Kroki options
| Parameter | Values | Default |
|-----------|---------|--------|
| `output-format` | `svg`, `png`, `pdf` | `svg` |
| `theme` | `default`, `dark`, etc. | `default` |

## Gotchas

- **Kroki + remote includes**: `!include https://raw.githubusercontent.com/...` fails → Kroki blocks remote URLs. Always use `<C4/C4_Context>` (local stdlib).
- **Parameter order**: Container/Component have `technology` in 3rd position (absent from Person/System). Forgetting `technology` shifts all the optional parameters.
- **A single include**: including the deepest level is enough — `C4_Container` already includes `C4_Context`. Avoid duplicates.
- **`_Ext` for external elements**: elements outside the scope (third-party systems, external users) use `Person_Ext`, `System_Ext`, etc. — visually distinguished.
- **Layout v2.12+**: `LAYOUT_LANDSCAPE()` combined with `Lay_*()` has behaved differently since PlantUML v2.12 (up↔left and down↔right are no longer swapped).
- **Boundaries require `{ }`**: the `*_Boundary` and `Deployment_Node` macros wrap their content in braces, no `end` keyword.

## Examples

### Context (level 1)
```c4plantuml
@startuml
!include <C4/C4_Context>

Person(user, "User", "Application client")
System(webapp, "Web Application", "Handles requests")
SystemDb(db, "Database", "Stores data")
System_Ext(email, "Email System", "Sends emails")

Rel(user, webapp, "Uses", "HTTPS")
Rel(webapp, db, "Reads/Writes", "SQL")
Rel(webapp, email, "Sends", "SMTP")

LAYOUT_WITH_LEGEND()
@enduml
```

### Container (level 2) with boundary
```c4plantuml
@startuml
!include <C4/C4_Container>

Person(user, "User")

System_Boundary(sys, "E-commerce System") {
    Container(spa, "SPA", "React", "User interface")
    Container(api, "API", "Node.js", "Business logic")
    ContainerDb(db, "DB", "PostgreSQL", "Orders and products")
}

System_Ext(payment, "Stripe", "Online payment")

Rel(user, spa, "Browses", "HTTPS")
Rel(spa, api, "Calls", "REST/JSON")
Rel(api, db, "Persists", "SQL")
Rel(api, payment, "Bills", "HTTPS")

LAYOUT_WITH_LEGEND()
@enduml
```
