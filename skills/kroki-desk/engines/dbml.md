# DBML

**API ID**: `dbml` | **Output**: SVG | **Best for**: Database schemas with types, constraints and relations

## Syntax

### Table
```dbml
Table [schema.]name [as alias] {
  col_name  type  [settings]
  indexes { ... }
  Note: 'table note'
}
```

### Column settings (inside `[]`, separated by `,`)
| Setting | Description |
|---|---|
| `pk` | primary key |
| `increment` | auto-increment |
| `not null` / `null` | nullability constraint |
| `unique` | uniqueness constraint |
| `default: val` | value: number, `'string'`, `` `expr` ``, bool |
| `note: 'text'` | documentation |
| `` check: `expr` `` | validation constraint |
| `ref: > table.col` | inline reference (see Relations) |

### Relations
Operators: `>` many-to-one · `<` one-to-many · `-` one-to-one · `<>` many-to-many

```dbml
// Inline (in the column)
user_id integer [ref: > users.id]

// Short form
Ref: posts.user_id > users.id

// Long form (with settings)
Ref fk_name {
  orders.user_id > users.id [delete: cascade, update: no action]
}
```

Settings ref : `delete/update: cascade | restrict | set null | set default | no action`

### Indexes
```dbml
indexes {
  (col1, col2) [pk]                          // composite key
  col_name [name: 'idx_name', unique, type: btree|hash]
  (`lower(email)`)                           // expression
}
```

### Enum
```dbml
enum [schema.]status_enum {
  active   [note: 'active account']
  inactive
  "pending review"   // values with spaces in quotes
}
```

### TableGroup
```dbml
TableGroup auth [color: #3498db] {
  users
  sessions
}
```

### Project
```dbml
Project my_app {
  database_type: 'PostgreSQL'
  Note: 'project description'
}
```

### Notes & comments
```dbml
Note: 'single line'
Note { '''
  multi-line
  with triple quotes
''' }
// line comment
/* block comment */
```

## Gotchas

- **Names with spaces**: double quotes required → `"created at"`
- **Multi-word type**: not allowed directly → use `decimal(1,2)`, not `decimal(1, 2)` with a space
- **Inline ref**: the annotated column is always the FK (foreign side)
- **Long form ref**: the `source > target` order determines the direction, not the position in the file
- **Schema** : `public` by default if omitted
- **Multi-line strings** : `'''...'''` only (not `"""`)
- **default expressions**: backticks required → `` `now()` `` not `now()`

## Examples

### Basic (users / posts)
```dbml
Table users {
  id        integer   [pk, increment]
  username  varchar   [not null, unique]
  email     varchar   [not null]
  role      user_role
  created_at timestamp [default: `now()`]
}

Table posts {
  id       integer [pk, increment]
  title    varchar [not null]
  body     text
  user_id  integer [not null, ref: > users.id]
  status   varchar [default: 'draft']
}

enum user_role {
  admin
  editor
  viewer
}

Ref: posts.user_id > users.id [delete: cascade]
```

### E-commerce with indexes and groups
```dbml
Project shop {
  database_type: 'PostgreSQL'
  Note: 'Online shop'
}

Table customers {
  id    integer  [pk, increment]
  email varchar  [not null, unique, note: 'primary identifier']
  name  varchar  [not null]

  indexes {
    email [unique, name: 'idx_customers_email']
  }
}

Table orders {
  id          integer   [pk, increment]
  customer_id integer   [not null]
  total       decimal(10,2) [not null, default: 0]
  status      order_status [default: 'pending']
  created_at  timestamp [default: `now()`]

  indexes {
    (customer_id, status) [name: 'idx_orders_cust_status']
  }
}

Table order_items {
  order_id   integer [not null]
  product_id integer [not null]
  qty        integer [not null, default: 1]

  indexes {
    (order_id, product_id) [pk]
  }
}

enum order_status { pending shipped delivered cancelled }

Ref: orders.customer_id > customers.id [delete: restrict]
Ref: order_items.order_id > orders.id [delete: cascade]

TableGroup commerce {
  customers
  orders
  order_items
}
```
