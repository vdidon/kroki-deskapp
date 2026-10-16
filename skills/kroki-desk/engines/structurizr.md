# Structurizr

> ⛔ **Not embedded in Kroki Desk.** This engine is recognised by Kroki upstream but
> is *not* compiled into the app: it renders only through an external Kroki server
> configured in the settings. Without one the block shows an error whatever the
> syntax — and the local API answers **HTTP 400**, same as a syntax error, so do not
> "fix" a source that was never going to render here. Pick an embedded engine
> (`d2`, `graphviz`, `mermaid`…) unless the user has a server, and say so in one line.

> **Embedded C4 alternative**: `c4plantuml` ☕ covers all four C4 levels and *is*
> compiled into Kroki Desk (Java required). Prefer it unless the user needs
> Structurizr's multi-view model from a single source.

**API ID**: `structurizr` | **Output**: SVG, PNG, PDF, TXT | **Best for**: C4 architecture, multiple views from a single model

## Syntax

```
workspace [name] [description] {
  !identifiers hierarchical   // flat(default)|hierarchical (dot-notation)
  !impliedRelationships false  // disable automatic implied relationships
  model {
    user = person "User" "Description" "tag1,tag2"
    sys = softwareSystem "My System" {
      web = container "Web App" "desc" "Java/Spring"
      db  = container "Database" "" "PostgreSQL" { tags "Database" }
    }
    ext = softwareSystem "External"
    user -> sys "Uses"
    sys  -> ext "Calls" "HTTPS"
  }
  views {
    systemContext sys [key] [description] {
      include *
      autoLayout lr 300 100
    }
    container sys {
      include *
      autoLayout tb
    }
    component web {
      include *
      autoLayout lr
    }
    deployment * prod "dep-prod" {
      include *
      autoLayout tb
    }
    dynamic sys "seq" {
      user -> web "login"
      web  -> db  "query"
      autoLayout lr
    }
    filtered "container" include "Database" "filtered-db"
    styles {
      element "Database" { shape Cylinder; background #336791; color #ffffff }
      element "Person"   { shape Person }
      relationship "Relationship" { style dashed; routing Orthogonal }
    }
    theme default
  }
}
```

**Model elements** : `person` · `softwareSystem` · `container` · `component` · `deploymentEnvironment` · `deploymentNode` · `infrastructureNode` · `softwareSystemInstance` · `containerInstance`

**Views** : `systemLandscape` · `systemContext` · `container` · `component` · `deployment` · `dynamic` · `filtered` · `custom` · `image`

**autoLayout** directions: `tb` (top-bottom) · `bt` · `lr` · `rl` — optional params: `rankSep nodeSep`

**Shapes** : `Box` · `Circle` · `Cylinder` · `Person` · `RoundedBox` · `Pipe` · `Hexagon` · `Component`

**Variables**: `!const NAME value` / `!var NAME value` → ref `${NAME}`

## Options Kroki

- `view-key`: select a specific view of the workspace
- `output`: `diagram` | `legend`

## Gotchas

- **camelCase REQUIRED**: `autoLayout` (not `autolayout`) — keywords are case-insensitive BUT Kroki tooling may be strict
- **Identifier ≠ keyword**: do not name an identifier `softwareSystem`, `container`, etc. — it clashes with DSL keywords; prefer `sys`, `web`, `db`
- **Forward referencing is forbidden**: define elements before referencing them
- **`{` on the same line**: the opening brace cannot be on a separate line
- **Stable view keys**: set keys manually to preserve layouts
- **Identifiers are global by default**: two `api` in different systems = conflict → use `!identifiers hierarchical` + dot-notation (`sys1.api`)
- **Uniqueness required**: person/softwareSystem names are globally unique; containers are unique within their system; views have unique keys
- **`""` to skip an optional parameter**: `container "DB" "" "PostgreSQL"` (empty description)
- **`include *`** in deployment = includes all deployment nodes in the targeted environment

## Examples

### Complete multi-view system

```structurizr
workspace {
  model {
    user = person "User"
    sys = softwareSystem "Software System" {
      webapp = container "Web Application" "Handles HTTP requests" "Java/Spring"
      db     = container "Database" "Stores data" "PostgreSQL" { tags "Database" }
    }
    user -> webapp "Uses"
    webapp -> db "Reads/Writes"
  }
  views {
    container sys {
      include *
      autoLayout lr
    }
    styles {
      element "Database" { shape Cylinder }
    }
  }
}
```

### Multi-environment deployment

```structurizr
workspace {
  model {
    sys = softwareSystem "App" {
      web = container "Web" "" "Node.js"
    }
    prod = deploymentEnvironment "Production" {
      server = deploymentNode "AWS EC2" "" "Amazon Linux" {
        webInst = containerInstance web
      }
    }
  }
  views {
    deployment sys "Production" "dep-prod" {
      include *
      autoLayout tb
    }
  }
}
```
