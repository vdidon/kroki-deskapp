// Consistency of the typed IPC contract (types/ipc.d.ts) with the Rust and the frontend.
//
// Standalone: no application, no npm. Checks that
//   1. the commands of `Commands` are exactly those of `generate_handler!`
//      (src-tauri/src/main.rs);
//   2. their arguments are those of the Rust function, in camelCase, excluding
//      parameters injected by Tauri (AppHandle, WebviewWindow, Window, State);
//      a Rust `Option<…>` must be optional (`?`) on the TypeScript side, and
//      vice versa;
//   3. every frontend `invoke("…")` command (ui/, excluding vendor) exists —
//      `tsc` only checks that in `// @ts-check` files.
// Return types, on the other hand, are not compared: re-read the Rust struct
// when changing an entry.
//
//   node tests/test_ipc_types.mjs

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src-tauri", "src");

let failures = 0;
function fail(msg) {
  failures++;
  console.log(`  ✗ ${msg}`);
}

function listFiles(dir, ext) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? e.name === "vendor"
        ? []
        : listFiles(join(dir, e.name), ext)
      : e.name.endsWith(ext)
        ? [join(dir, e.name)]
        : [],
  );
}

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const INJECTED = /^(AppHandle|WebviewWindow|Window|State\b)/;

// --- Rust: registered commands and their parameters -------------------------

const mainRs = readFileSync(join(SRC, "main.rs"), "utf8");
const handler = mainRs.match(/generate_handler!\[([\s\S]*?)\]/);
if (!handler) throw new Error("generate_handler! not found in main.rs");
const registered = new Set(
  [...handler[1].replace(/\/\/[^\n]*/g, "").matchAll(/\b\w+::(\w+)/g)].map((m) => m[1]),
);

/** name → Map(argCamel → optional) */
const rust = new Map();
for (const file of listFiles(SRC, ".rs")) {
  const src = readFileSync(file, "utf8");
  const re = /#\[tauri::command\][\s\S]*?\bfn\s+(\w+)\s*(?:<[^>]*>)?\s*\(([\s\S]*?)\)\s*(?:->|\{)/g;
  for (const m of src.matchAll(re)) {
    const args = new Map();
    for (const param of m[2].replace(/\/\/[^\n]*/g, "").split(/,(?![^<]*>)/)) {
      const p = param.trim().match(/^(?:mut\s+)?(\w+)\s*:\s*([\s\S]+)$/);
      if (!p || INJECTED.test(p[2].trim())) continue;
      args.set(camel(p[1]), /^Option\s*</.test(p[2].trim()));
    }
    rust.set(m[1], args);
  }
}

// --- TypeScript: Commands interface ------------------------------------------

const ipc = readFileSync(join(ROOT, "types", "ipc.d.ts"), "utf8");
const body = ipc.match(/export interface Commands \{([\s\S]*?)\n\}/);
if (!body) throw new Error("interface Commands not found in types/ipc.d.ts");
/** name → Map(arg → optional) */
const ts = new Map();
// One entry: `name: { args: NoArgs | { … }; ret: … };`, possibly spanning several lines.
for (const m of body[1].replace(/\/\/[^\n]*/g, "").matchAll(/(\w+):\s*\{\s*args:\s*(NoArgs|\{([\s\S]*?)\})\s*;\s*ret:/g)) {
  const args = new Map();
  if (m[2] !== "NoArgs") {
    for (const a of m[3].matchAll(/(\w+)(\??)\s*:/g)) args.set(a[1], a[2] === "?");
  }
  ts.set(m[1], args);
}

console.log("Registered commands");
for (const name of registered) {
  if (!rust.has(name)) fail(`${name}: registered but no #[tauri::command] function found`);
  if (!ts.has(name)) fail(`${name}: missing from Commands (types/ipc.d.ts)`);
}
for (const name of ts.keys()) {
  if (!registered.has(name)) fail(`${name}: in Commands but not in generate_handler!`);
}

console.log("Arguments");
for (const [name, tsArgs] of ts) {
  const rsArgs = rust.get(name);
  if (!rsArgs) continue;
  for (const [arg, optional] of rsArgs) {
    if (!tsArgs.has(arg)) fail(`${name}: argument "${arg}" missing on the TypeScript side`);
    else if (tsArgs.get(arg) !== optional)
      fail(`${name}: "${arg}" ${optional ? "is a Rust Option<…>, must be optional" : "is required on the Rust side, not optional"}`);
  }
  for (const arg of tsArgs.keys()) {
    if (!rsArgs.has(arg)) fail(`${name}: argument "${arg}" unknown to Rust`);
  }
}

console.log("Frontend calls");
let calls = 0;
for (const file of listFiles(join(ROOT, "ui"), ".js")) {
  for (const m of readFileSync(file, "utf8").matchAll(/\binvoke\(\s*["'](\w+)["']/g)) {
    calls++;
    if (!ts.has(m[1])) fail(`${relative(ROOT, file)}: invoke("${m[1]}") not in Commands`);
  }
}

console.log(failures ? `\n${failures} failure(s)` : `\nOK — ${ts.size} commands, ${calls} invoke calls`);
process.exit(failures ? 1 : 0);
