// Consistency of the language catalogs (src-tauri/i18n/*.json) with the code.
//
// Standalone: no application, no npm. Checks that
//   1. each catalog is valid JSON, with the same keys as en.json
//      (the reference), with the same plural forms and the same `{param}`s;
//   2. every key in use exists: `t("…")` (ui/js, ui/renderer excluding vendor),`data-i18n*="…"`
//      (ui/index.html), `tr!("…")` (src-tauri/src);
//   3. no key is dead — except those of a prefix announced in the code by
//      an `i18n-dynamic: <prefix>` comment (key built at runtime).
//
//   node tests/test_i18n.mjs

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG_DIR = join(ROOT, "src-tauri", "i18n");

let failures = 0;
function fail(msg) {
  failures++;
  console.log(`  ✗ ${msg}`);
}

function listFiles(dir, ext) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? listFiles(join(dir, e.name), ext)
      : e.name.endsWith(ext)
        ? [join(dir, e.name)]
        : [],
  );
}

// 1. Catalogs -----------------------------------------------------------------
const catalogs = {};
for (const name of readdirSync(CATALOG_DIR).filter((n) => n.endsWith(".json"))) {
  try {
    catalogs[name.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(CATALOG_DIR, name), "utf8"));
  } catch (err) {
    fail(`${name}: invalid JSON (${err.message})`);
  }
}
const ref = catalogs.en;
if (!ref) {
  console.log("en.json not found");
  process.exit(1);
}

const params = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const forms = (v) => (typeof v === "object" ? Object.values(v) : [v]);

console.log("Catalogs");
for (const [lang, cat] of Object.entries(catalogs)) {
  for (const key of Object.keys(ref)) {
    if (!(key in cat)) fail(`${lang}: missing key "${key}"`);
  }
  for (const [key, value] of Object.entries(cat)) {
    if (!(key in ref)) {
      fail(`${lang}: key not in en.json "${key}"`);
      continue;
    }
    if (typeof value !== "string" && (typeof value !== "object" || !("other" in value))) {
      fail(`${lang}: "${key}" must be a string or a plural object with "other"`);
      continue;
    }
    // Same parameters as the reference, in each form.
    const expected = new Set(forms(ref[key]).map(params));
    for (const f of forms(value)) {
      if (!expected.has(params(f))) fail(`${lang}: parameters of "${key}" differ from en.json (${params(f) || "none"})`);
    }
  }
}

// 2. Keys in use --------------------------------------------------------------
const used = new Map(); // key -> first file
const dynamic = [];
const sources = [
  ...[join(ROOT, "ui", "js"), join(ROOT, "ui", "renderer")]
    .flatMap((d) => listFiles(d, ".js"))
    .filter((f) => !/[\\/]vendor[\\/]/.test(f))
    .map((f) => [f, /\bt\(\s*["']([\w.-]+)["']/g]),
  [join(ROOT, "ui", "index.html"), /data-i18n(?:-[\w-]+)?="([\w.-]+)"/g],
  ...listFiles(join(ROOT, "src-tauri", "src"), ".rs").map((f) => [f, /\btr!\(\s*"([\w.-]+)"/g]),
];
for (const [file, re] of sources) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(re)) if (!used.has(m[1])) used.set(m[1], file);
  for (const m of text.matchAll(/i18n-dynamic:\s*([\w.-]+)/g)) dynamic.push(m[1]);
}
// Read by name in i18n.rs (language selector), without going through tr!.
used.set("language.name", "src-tauri/src/i18n.rs");

console.log("Keys in use");
for (const [key, file] of used) {
  if (!(key in ref)) fail(`unknown key "${key}" (${file.slice(ROOT.length + 1)})`);
}

console.log("Dead keys");
for (const key of Object.keys(ref)) {
  if (!used.has(key) && !dynamic.some((p) => key.startsWith(p))) fail(`key never used "${key}"`);
}

const total = Object.keys(ref).length;
console.log(
  failures
    ? `\n${failures} failure(s)`
    : `\nOK — ${total} keys, ${Object.keys(catalogs).length} languages (${Object.keys(catalogs).join(", ")})`,
);
process.exit(failures ? 1 : 0);
