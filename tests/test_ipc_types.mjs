// Cohérence du contrat IPC typé (types/ipc.d.ts) avec le Rust et le frontend.
//
// Autonome : ni application, ni npm. Vérifie que
//   1. les commandes de `Commands` sont exactement celles de `generate_handler!`
//      (src-tauri/src/main.rs) ;
//   2. leurs arguments sont ceux de la fonction Rust, en camelCase, hors
//      paramètres injectés par Tauri (AppHandle, WebviewWindow, Window, State) ;
//      un `Option<…>` Rust doit être optionnel (`?`) côté TypeScript, et
//      réciproquement ;
//   3. toute commande `invoke("…")` du frontend (ui/, hors vendor) existe —
//      `tsc` ne le vérifie que dans les fichiers `// @ts-check`.
// Les types de retour, eux, ne sont pas comparés : relire la struct Rust en
// modifiant une entrée.
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

// --- Rust : commandes enregistrées et leurs paramètres -----------------------

const mainRs = readFileSync(join(SRC, "main.rs"), "utf8");
const handler = mainRs.match(/generate_handler!\[([\s\S]*?)\]/);
if (!handler) throw new Error("generate_handler! introuvable dans main.rs");
const registered = new Set(
  [...handler[1].replace(/\/\/[^\n]*/g, "").matchAll(/\b\w+::(\w+)/g)].map((m) => m[1]),
);

/** nom → Map(argCamel → optionnel) */
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

// --- TypeScript : interface Commands ----------------------------------------

const ipc = readFileSync(join(ROOT, "types", "ipc.d.ts"), "utf8");
const body = ipc.match(/export interface Commands \{([\s\S]*?)\n\}/);
if (!body) throw new Error("interface Commands introuvable dans types/ipc.d.ts");
/** nom → Map(arg → optionnel) */
const ts = new Map();
// Une entrée : `nom: { args: NoArgs | { … }; ret: … };`, éventuellement sur plusieurs lignes.
for (const m of body[1].replace(/\/\/[^\n]*/g, "").matchAll(/(\w+):\s*\{\s*args:\s*(NoArgs|\{([\s\S]*?)\})\s*;\s*ret:/g)) {
  const args = new Map();
  if (m[2] !== "NoArgs") {
    for (const a of m[3].matchAll(/(\w+)(\??)\s*:/g)) args.set(a[1], a[2] === "?");
  }
  ts.set(m[1], args);
}

console.log("Commandes enregistrées");
for (const name of registered) {
  if (!rust.has(name)) fail(`${name} : enregistrée mais aucune fonction #[tauri::command] trouvée`);
  if (!ts.has(name)) fail(`${name} : absente de Commands (types/ipc.d.ts)`);
}
for (const name of ts.keys()) {
  if (!registered.has(name)) fail(`${name} : dans Commands mais pas dans generate_handler!`);
}

console.log("Arguments");
for (const [name, tsArgs] of ts) {
  const rsArgs = rust.get(name);
  if (!rsArgs) continue;
  for (const [arg, optional] of rsArgs) {
    if (!tsArgs.has(arg)) fail(`${name} : argument « ${arg} » absent côté TypeScript`);
    else if (tsArgs.get(arg) !== optional)
      fail(`${name} : « ${arg} » ${optional ? "est un Option<…> Rust, doit être optionnel" : "est requis côté Rust, pas optionnel"}`);
  }
  for (const arg of tsArgs.keys()) {
    if (!rsArgs.has(arg)) fail(`${name} : argument « ${arg} » inconnu du Rust`);
  }
}

console.log("Appels du frontend");
let calls = 0;
for (const file of listFiles(join(ROOT, "ui"), ".js")) {
  for (const m of readFileSync(file, "utf8").matchAll(/\binvoke\(\s*["'](\w+)["']/g)) {
    calls++;
    if (!ts.has(m[1])) fail(`${relative(ROOT, file)} : invoke("${m[1]}") hors de Commands`);
  }
}

console.log(failures ? `\n${failures} échec(s)` : `\nOK — ${ts.size} commandes, ${calls} appels invoke`);
process.exit(failures ? 1 : 0);
