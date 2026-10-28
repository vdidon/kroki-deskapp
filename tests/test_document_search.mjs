// Test of the search in the displayed document (ui/js/docsearch.js) and of the
// `Aa` / `ab` / `.*` options shared by both searches (ui/js/searchopts.js).
// Usage: node tests/test_document_search.mjs [port]
// Prerequisite: app launched with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>
// Standalone: creates its test document in a temporary folder, opens it via
// the Tauri commands, closes its tab at the end.
//
// Acknowledged blind spot: that the webview's NATIVE search bar no longer
// opens on Ctrl+F cannot be checked from here (it lives outside the page's
// DOM) — visual check.

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = process.argv[2] ?? "9222";

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page" && !t.url.includes("renderer"));
if (!page) {
  console.error("main page not found:", targets.map((t) => t.title).join(" | "));
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
let nextId = 1;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
};
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((res) => {
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expr) {
  const r = await send("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, cond, detail = "") {
  console.log(`${cond ? "OK " : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}

// --- Fixture: mixed cases, partial words, accents (for "whole word")
const dir = mkdtempSync(join(tmpdir(), "kroki-find-test-"));
const docPath = join(dir, "recherche_doc.md");
writeFileSync(
  docPath,
  [
    "# Zoxitron",
    "",
    "Première ligne avec zoxitron dedans.",
    "",
    "Ensuite ZOXITRON en capitales, puis zoxitronique qui n'est pas le mot entier.",
    "",
    "## Accents",
    "",
    "Un été chaud, et un étex qui n'est pas été.",
    "",
    "Codes : ab12, cd34, ef56.",
    "",
  ].join("\n"),
);
// "zoxitron" case-insensitive: title + 3 in the body = 4.
// Case-sensitive ("zoxitron"): line 3 + zoxitronique = 2.
// Whole word + insensitive: 4 - 1 (zoxitronique) = 3.

const esc = (s) => JSON.stringify(s);
await evaluate(
  `window.__TAURI__.core.invoke('open_link', { baseDir: ${esc(dir)}, href: 'recherche_doc.md' })`,
);
await sleep(900);

const state = () => evaluate(`(() => ({
  hidden: document.getElementById('find-bar').hidden,
  focused: document.activeElement === document.getElementById('find-input'),
  count: document.getElementById('find-count').textContent,
  invalid: document.getElementById('find-input').classList.contains('invalid'),
  all: CSS.highlights.get('find-occurrences')?.size ?? 0,
  current: CSS.highlights.get('find-current')?.size ?? 0,
}))()`);

const setQuery = async (q) => {
  await evaluate(`(() => {
    const i = document.getElementById('find-input');
    i.value = ${esc(q)};
    i.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(300);
};
const toggle = async (bar, opt) => {
  await evaluate(`document.querySelector('#${bar}-opts button[data-opt="${opt}"]').click()`);
  await sleep(300);
};
const key = (k, mods = {}) =>
  evaluate(
    `window.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ key: k, bubbles: true, ...mods })}))`,
  );

try {
  // 1. Ctrl+F opens the bar
  await key("f", { ctrlKey: true });
  await sleep(200);
  let st = await state();
  check("Ctrl+F opens the bar", st.hidden === false);
  check("field focused on open", st.focused === true);

  // 2. Case-insensitive search: 4 occurrences, the 1st one current
  await setQuery("zoxitron");
  st = await state();
  check("4 occurrences, counter 1/4", st.count === "1/4", st.count);
  check("all occurrences highlighted", st.all === 4, `all=${st.all}`);
  check("current occurrence distinct", st.current === 1, `current=${st.current}`);

  // 3. Navigation: Enter goes forward, Shift+Enter goes back, F3 goes forward, wrap-around
  await evaluate(`document.getElementById('find-input').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await sleep(150);
  check("Enter → next occurrence", (await state()).count === "2/4");
  await evaluate(`document.getElementById('find-input').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }))`);
  await sleep(150);
  check("Shift+Enter → previous occurrence", (await state()).count === "1/4");
  await key("F3", { shiftKey: true });
  await sleep(150);
  check("Shift+F3 wraps to the last", (await state()).count === "4/4");
  await key("F3");
  await sleep(150);
  check("F3 wraps to the first", (await state()).count === "1/4");

  // 4. "Match case" option
  await toggle("find", "case");
  check("Aa: 2 occurrences", (await state()).count === "1/2", (await state()).count);
  await toggle("find", "case");

  // 5. Option « mot entier » (zoxitronique exclu)
  await toggle("find", "word");
  check("ab: 3 occurrences (zoxitronique excluded)", (await state()).count === "1/3",
    (await state()).count);
  // …and on an accented word, where ASCII `\b` would fail
  await setQuery("été");
  check("ab: accents handled (2 'été' out of 3 forms)", (await state()).count === "1/2",
    (await state()).count);
  await toggle("find", "word");

  // 6. Regular expression (valid then invalid)
  await toggle("find", "regex");
  await setQuery("[a-f]{2}[0-9]{2}");
  check(".*: 3 codes found", (await state()).count === "1/3", (await state()).count);
  await setQuery("a(");
  st = await state();
  // Independent of the interface language: "invalide" (fr) or "Invalid" (en).
  check("invalid pattern: error message", /invalid/i.test(st.count), st.count);
  check("invalid pattern: field in red", st.invalid === true);
  check("invalid pattern: highlight cleared", st.all === 0);
  await toggle("find", "regex");
  await setQuery("zoxitron");

  // 7. Mutual exclusion with the multi-document search (same on-screen anchor)
  await key("F", { ctrlKey: true, shiftKey: true });
  await sleep(300);
  const excl = await evaluate(`(() => ({
    find: document.getElementById('find-bar').hidden,
    panel: document.getElementById('search-panel').hidden,
  }))()`);
  check("Ctrl+Shift+F closes the Ctrl+F bar", excl.find === true && excl.panel === false,
    JSON.stringify(excl));

  // 8. Multi-document panel options: case + close button
  await evaluate(`(() => {
    const i = document.getElementById('search-input');
    i.value = 'zoxitron';
    i.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(900);
  const insensible = await evaluate(
    `document.querySelector('.search-group .search-count')?.textContent`,
  );
  check("panel: 4 occurrences without options", insensible === "4", String(insensible));
  await toggle("search", "case");
  await sleep(700);
  const sensible = await evaluate(
    `document.querySelector('.search-group .search-count')?.textContent`,
  );
  check("panel: Aa → 2 occurrences", sensible === "2", String(sensible));
  await toggle("search", "case");
  await sleep(700);

  await evaluate(`document.getElementById('search-close').click()`);
  await sleep(200);
  check("panel: close button", await evaluate(
    `document.getElementById('search-panel').hidden`,
  ));

  // 9. Escape closes the bar and clears the highlights
  await key("f", { ctrlKey: true });
  await sleep(200);
  await setQuery("zoxitron");
  await key("Escape");
  await sleep(200);
  st = await state();
  check("Escape closes the bar", st.hidden === true);
  check("highlights cleared on close", st.all === 0 && st.current === 0,
    `all=${st.all} current=${st.current}`);
} finally {
  await evaluate(`(async () => {
    const st = await window.__TAURI__.core.invoke('get_window_state');
    for (const t of st.tabs) {
      if (t.title === 'recherche_doc.md') {
        await window.__TAURI__.core.invoke('close_tab', { docId: t.id });
      }
    }
  })()`).catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nALL TESTS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
