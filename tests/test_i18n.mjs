// Cohérence des catalogues de langue (src-tauri/i18n/*.json) avec le code.
//
// Autonome : ni application, ni npm. Vérifie que
//   1. chaque catalogue est un JSON valide, aux mêmes clés que en.json
//      (la référence), avec les mêmes formes plurielles et les mêmes `{param}` ;
//   2. toute clé employée existe : `t("…")` (ui/js, ui/renderer hors vendor),`data-i18n*="…"`
//      (ui/index.html), `tr!("…")` (src-tauri/src) ;
//   3. aucune clé n'est morte — sauf celles d'un préfixe annoncé dans le code par
//      un commentaire `i18n-dynamic: <préfixe>` (clé construite à l'exécution).
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

// 1. Catalogues ---------------------------------------------------------------
const catalogs = {};
for (const name of readdirSync(CATALOG_DIR).filter((n) => n.endsWith(".json"))) {
  try {
    catalogs[name.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(CATALOG_DIR, name), "utf8"));
  } catch (err) {
    fail(`${name} : JSON invalide (${err.message})`);
  }
}
const ref = catalogs.en;
if (!ref) {
  console.log("en.json introuvable");
  process.exit(1);
}

const params = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const forms = (v) => (typeof v === "object" ? Object.values(v) : [v]);

console.log("Catalogues");
for (const [lang, cat] of Object.entries(catalogs)) {
  for (const key of Object.keys(ref)) {
    if (!(key in cat)) fail(`${lang} : clé manquante « ${key} »`);
  }
  for (const [key, value] of Object.entries(cat)) {
    if (!(key in ref)) {
      fail(`${lang} : clé absente de en.json « ${key} »`);
      continue;
    }
    if (typeof value !== "string" && (typeof value !== "object" || !("other" in value))) {
      fail(`${lang} : « ${key} » doit être un texte ou un objet de pluriels avec « other »`);
      continue;
    }
    // Mêmes paramètres que la référence, dans chaque forme.
    const expected = new Set(forms(ref[key]).map(params));
    for (const f of forms(value)) {
      if (!expected.has(params(f))) fail(`${lang} : paramètres de « ${key} » ≠ en.json (${params(f) || "aucun"})`);
    }
  }
}

// 2. Clés employées -----------------------------------------------------------
const used = new Map(); // clé -> premier fichier
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
// Lue par son nom dans i18n.rs (sélecteur de langue), sans passer par tr!.
used.set("language.name", "src-tauri/src/i18n.rs");

console.log("Clés employées");
for (const [key, file] of used) {
  if (!(key in ref)) fail(`clé inconnue « ${key} » (${file.slice(ROOT.length + 1)})`);
}

console.log("Clés mortes");
for (const key of Object.keys(ref)) {
  if (!used.has(key) && !dynamic.some((p) => key.startsWith(p))) fail(`clé jamais employée « ${key} »`);
}

const total = Object.keys(ref).length;
console.log(
  failures
    ? `\n${failures} échec(s)`
    : `\nOK — ${total} clés, ${Object.keys(catalogs).length} langues (${Object.keys(catalogs).join(", ")})`,
);
process.exit(failures ? 1 : 0);
