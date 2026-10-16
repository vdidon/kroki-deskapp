# Network Diagrams Family

> ⛔ **Not embedded in Kroki Desk.** This engine is recognised by Kroki upstream but
> is *not* compiled into the app: it renders only through an external Kroki server
> configured in the settings. Without one the block shows an error whatever the
> syntax — and the local API answers **HTTP 400**, same as a syntax error, so do not
> "fix" a source that was never going to render here. Pick an embedded engine
> (`d2`, `graphviz`, `mermaid`…) unless the user has a server, and say so in one line.

Covers NwDiag, PacketDiag, and RackDiag. All share common CLI options: `antialias`, `no-transparency`, `size`, `no-doctype`

---

## NwDiag

**API ID**: `nwdiag` | **Output**: SVG, PNG, JPEG | **Best for**: Network topology diagrams

### Syntax

```
nwdiag {
  network <name> {
    address = "<cidr>";         // network label (optional)
    <node> [address = "<ip>"];  // interface IP
    <node> [address = "<ip1>, <ip2>"];  // multiple addresses
    <node> [shape = cloud|database|node|...];
    <node> [description = "multi-line\ntext"];
  }
  // Peer network (direct connection, no busbar)
  <node1> -- <node2>;
  // Colored groups (declared outside the network blocks)
  group <name> {
    color = "#rrggbb";
    <node1>; <node2>;
  }
}
```

**Available shapes**: `cloud`, `database`, `node`, `server`, `mail`, `actor`, `beginpoint`, `endpoint`, `note`, `mail`, `box`, `dots`

**Node attributes**: `address`, `description`, `shape`, `color`, `style`, `fontsize`, `textcolor`

**Network attributes**: `address` (displayed CIDR label), `color`, `style`

### Gotchas

- `group`s **must** be defined **outside** the `network { }` blocks, otherwise they are ignored
- A node on several networks = multi-homed, Kroki draws the "jump lines" automatically
- `--` (peer) creates a direct horizontal link without a network bus line
- Multiple addresses are comma-separated in a single value: `address = "10.0.0.1, 192.168.1.1"`
- The network-level `address` is a displayed **label**, not a filter

### Example

```nwdiag
nwdiag {
  inet [shape = cloud];
  inet -- router;

  network dmz {
    address = "210.x.x.x/24";
    router [address = "210.x.x.254"];
    web01  [address = "210.x.x.1"];
    web02  [address = "210.x.x.2"];
  }
  network internal {
    address = "172.x.x.x/24";
    router [address = "172.x.x.254"];
    web01  [address = "172.x.x.1"];
    db01   [address = "172.x.x.100", shape = database];
  }

  group frontend {
    color = "#FFaaaa";
    web01; web02;
  }
  group backend {
    color = "#aaaaFF";
    db01;
  }
}
```

---

## PacketDiag

**API ID**: `packetdiag` | **Output**: SVG, PNG, JPEG | **Best for**: Network packet structures, protocol headers

### Syntax

```
packetdiag {
  colwidth = 32;        // bits per line (default 32)
  node_height = 72;     // field height in pixels

  // Fields by bit range
  0-15:   <label>;
  16-31:  <label>;
  // Single-bit field
  32:     <label> [rotate = 270];   // vertical text
  // Multi-row field (spans several rows)
  48-79:  <label> [colheight = 2];
  // Background color
  80-95:  <label> [color = "#ffaaaa"];
}
```

**Field attributes**: `rotate` (degrees, e.g. 270 for vertical), `colheight` (number of rows), `color` (hex background)

**Global options**: `colwidth` (bits/line, typically 8, 16, 32), `node_height` (px)

### Gotchas

- Bit ranges are **absolute** from 0, not relative: `32-47` = bits 32 to 47
- `colwidth = 32` with a `0-63` field = the field automatically spans 2 rows
- `colheight` manually forces the height in rows for large fields
- `rotate = 270` is essential for 1-bit fields (otherwise the label is unreadable)
- No `nwdiag { }` wrapper: the root block is `packetdiag { }` directly

### Example

```packetdiag
packetdiag {
  colwidth = 32;
  node_height = 72;

  0-15:   Source Port;
  16-31:  Destination Port;
  32-63:  Sequence Number;
  64-95:  Acknowledgment Number;
  96-99:  Data Offset;
  100-105: Reserved;
  106:    URG [rotate = 270];
  107:    ACK [rotate = 270];
  108:    PSH [rotate = 270];
  109:    RST [rotate = 270];
  110:    SYN [rotate = 270];
  111:    FIN [rotate = 270];
  112-127: Window;
  128-143: Checksum;
  144-159: Urgent Pointer;
  160-191: Options and Padding;
  192-223: Data [colheight = 3];
}
```

---

## RackDiag

**API ID**: `rackdiag` | **Output**: SVG, PNG, JPEG | **Best for**: Server rack diagrams

### Syntax

```
rackdiag {
  // Single rack
  <N>U;               // total rack height (e.g. 16U)
  description = "Rack A";
  <pos>: <label> [<N>U];         // item at position pos, height N units
  <pos>: <label> [color = "#rrggbb"];
  <pos>: <label> [description = "text"];

  // Several items at the same position (side by side)
  4: Server A;
  4: Server B;

  // Reserved / empty space
  10: N/A [8U];

  // Multiple racks in the same diagram
  rack {
    16U;
    description = "Rack 1";
    1: UPS [2U];
    3: Switch;
  }
  rack {
    12U;
    description = "Rack 2";
    1: Firewall;
  }
}
```

**Item attributes**: `<N>U` (height), `color`, `description`, `fontsize`, `textcolor`

**Rack attributes**: `description`, `ascending` (reverses the numbering order, U1 at the top)

### Gotchas

- The total height (`16U`) is declared **before** the items, without a label
- The position is the item's **bottom unit number** (U1 = bottom of the rack by default)
- `ascending` reverses: U1 becomes the top (European datacenter convention)
- Two items at the same position are placed side by side horizontally
- `N/A` is a literal label, not a keyword: `5: N/A [3U]` reserves 3U
- For multiple racks: wrap each rack in `rack { }` inside a parent `rackdiag { }`

### Example

```rackdiag
rackdiag {
  rack {
    16U;
    description = "Main Rack";
    1: UPS [2U, color = "#ffdd99"];
    3: Firewall;
    4: Core Switch [2U];
    6: Web 1 [color = "#aaffaa"];
    6: Web 2 [color = "#aaffaa"];
    7: Web 3 [color = "#aaffaa"];
    8: DB Primary [color = "#aaaaff"];
    9: DB Replica [color = "#aaaaff"];
    10: N/A [7U];
  }
  rack {
    8U;
    description = "Rack DMZ";
    1: Reverse Proxy [2U];
    3: WAF;
    4: IDS;
  }
}
```
