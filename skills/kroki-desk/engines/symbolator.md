# Symbolator

> ⛔ **Not embedded in Kroki Desk.** This engine is recognised by Kroki upstream but
> is *not* compiled into the app: it renders only through an external Kroki server
> configured in the settings. Without one the block shows an error whatever the
> syntax — and the local API answers **HTTP 400**, same as a syntax error, so do not
> "fix" a source that was never going to render here. Pick an embedded engine
> (`d2`, `graphviz`, `mermaid`…) unless the user has a server, and say so in one line.

**API ID**: `symbolator` | **Output**: SVG, PNG | **Best for**: HDL component pin diagrams, hardware interface documentation

## Syntax

### VHDL — entity
```vhdl
library ieee;
use ieee.std_logic_1164.all;

entity NAME is
  generic (
    WIDTH : integer := 8
  );
  port (
    --# {{clocks|}}
    clk   : in  std_logic;
    rst_n : in  std_logic;
    --# {{data|Inputs}}
    A     : in  std_logic_vector(WIDTH-1 downto 0);
    --# {{data|Outputs}}
    Q     : out std_logic_vector(WIDTH-1 downto 0)
  );
end entity;
```

### Verilog — module (1995 & 2001 syntax)
```verilog
module NAME #(
  parameter WIDTH = 8
) (
  //# {{clocks|}}
  input  wire        clk,
  input  wire        rst_n,
  //# {{data|Inputs}}
  input  wire [WIDTH-1:0] a,
  //# {{data|Outputs}}
  output reg  [WIDTH-1:0] q
);
endmodule
```

## Port directions & types

| VHDL          | Verilog                     |
|---------------|-----------------------------|
| `in`          | `input`                     |
| `out`         | `output`                    |
| `inout`       | `inout`                     |
| `buffer`      | _(no direct equivalent)_ |

Common VHDL types: `std_logic`, `std_logic_vector(N downto 0)`, `integer`, `bit`, `boolean`, `natural`, `unsigned`, `signed`

## Sections (metacomments)

Syntax: `--# {{[style|]label}}` (VHDL) or `//#  {{[style|]label}}` (Verilog)

Fixed styles: `clocks` (blue), `control` (yellow), `data` (green) — any other value = random pastel color

```
--# {{}}              -- separator without label
--# {{clocks|}}       -- clocks section without title
--# {{data|Bus}}      -- data section titled "Bus"
--# {{MyGroup}}       -- custom pastel section
```

## Automatic rendering

- Name containing `clk`/`clock` → clock symbol (triangle)
- Name ending in `_n` or `_b` → inversion bubble
- `inout` / `bidir` → double arrow
- Vector/array → bus rendering (thick line)
- Generics/parameters → grey block at the top

## Gotchas

- Kroki only accepts **raw HDL code** in the block — no XML tags or JSON wrapping
- `end entity;` required in VHDL (some parsers reject a bare `end NAME;`)
- Verilog 1995 (port list without directions in the header) is parsed but 2001 is preferred
- The `use` / `library` VHDL are ignored by symbolator but cause no error
- `buffer` VHDL is rendered visually as `out`
- One component/module per block — the first one found is rendered

## Options Kroki

```
?component=1          -- force "component" rendering (VHDL)
?transparent=1        -- transparent background
?scale=2.0            -- scale factor
?no-type=1            -- hide types on pins
?library-name=ieee    -- displayed library label
```

## Examples

### ALU VHDL
```symbolator
library ieee;
use ieee.std_logic_1164.all;

entity ALU is
  port (
    A   : in  std_logic_vector(7 downto 0);
    B   : in  std_logic_vector(7 downto 0);
    Op  : in  std_logic_vector(1 downto 0);
    Res : out std_logic_vector(7 downto 0);
    Zero: out std_logic
  );
end entity;
```

### Verilog FIFO with sections
```symbolator
module fifo #(
  parameter DEPTH = 16,
  parameter WIDTH = 8
) (
  //# {{clocks|}}
  input  wire        clk,
  input  wire        rst_n,
  //# {{control|}}
  input  wire        wr_en,
  input  wire        rd_en,
  //# {{data|}}
  input  wire [WIDTH-1:0] din,
  output reg  [WIDTH-1:0] dout,
  output wire        full,
  output wire        empty
);
endmodule
```
