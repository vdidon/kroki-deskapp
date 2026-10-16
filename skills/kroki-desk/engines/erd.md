# ERD

**API ID**: `erd` | **Output**: SVG, PNG, JPEG, PDF | **Best for**: Clear, quick entity-relationship schemas

## Syntax

### Entities and attributes
```
[EntityName]
*primary_key
+foreign_key
*+composite_pk_and_fk
plain_attribute
`name with spaces`
```

Attribute prefixes (combinable):
- `*` = primary key (underlined)
- `+` = foreign key (italic)
- `*+` or `+*` = both at once
- none = plain attribute

### Cardinalities
Syntax: `Entity1 card--card Entity2`

| Symbol | Meaning |
|---------|--------------|
| `1` | exactly 1 |
| `?` | 0 or 1 |
| `*` | 0 or more |
| `+` | 1 or more |

Common combinations: `1--1` `1--*` `*--*` `?--1` `+--*` `?--*`

### Options inline
```
[Entity] {bgcolor: "#ececfc", size: "20"}
attr {label: "varchar(255), NOT NULL"}
Entity1 *--1 Entity2 {label: "belongs to"}
```

Available options: `label`, `color`, `bgcolor`, `size`, `font`, `border`, `border-color`

### Global directives (at the top of the file)
```
title {label: "My schema", size: "20"}
entity {bgcolor: "#ececfc"}
header {color: "#333333"}
relationship {color: "#666666"}
```

Mandatory order: global directives first, then entities and relations.

### Comments
```
# This is a comment
```

## CLI options (Kroki context)
Kroki exposes the tool directly; rendering options are passed via the request:
- `-e` edge style: `compound`, `noedge`, `ortho`, `poly`, `spline`
- `-p` pattern: `dashed`, `dotted`, `solid`
- `-n` notation: `ie` (crow's foot, default), `uml`

## Gotchas

- **Global directives must come first** — any entity before a directive = parse error
- **`*` is ambiguous**: in a relation `*--1` it is a cardinality; on an attribute it is a primary key — different context
- **Names with spaces**: use backticks `` ` ``, single quotes `'` or double quotes `"`
- **No `~` discriminator** — this prefix does not exist in BurntSushi/erd (only `*` and `+` are recognized)
- Local options override global directives
- `bgcolor` is not supported on `title`

## Examples

### Simple
```erd
[Person]
*id
+birth_place_id
name
height

[Location]
*id
city
country

Person *--1 Location
```

### Complex (multi-author blog)
```erd
title {label: "Blog Schema", size: "18"}
entity {bgcolor: "#ececfc"}
header {bgcolor: "#9999ff"}
relationship {label: ""}

[User] {bgcolor: "#d0e0d0"}
*id {label: "serial PK"}
email {label: "varchar(255) UNIQUE"}
name

[Post] {bgcolor: "#d0e0d0"}
*id
*+author_id {label: "FK -> User"}
title {label: "varchar(512)"}
published_at

[Tag]
*id
name {label: "varchar(64) UNIQUE"}

[PostTag]
*+post_id
*+tag_id

User 1--* Post {label: "writes"}
Post *--* Tag
Post *--1 PostTag
Tag  *--1 PostTag
```
