// Test of the loading overlay (ui/js/loading.js).
// Usage: node tests/test_loading.mjs [port]
// Prerequisite: app launched with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>
// Standalone: creates its documents in a temporary folder, only closes its
// own tabs.
//
// What is checked — the overlay must appear **only** when the wait
// justifies it:
//   1. large document         → overlay shown then removed;
//   2. switch → source code   → no overlay (this view goes through neither
//                               markdown-it nor KaTeX: ~100 ms);
//   3. switch → preview       → overlay (the full pipeline is replayed);
//   4. small document         → no overlay (anti-flash delay).
// Plus the invariant that makes the overlay useful: its animation must survive
// the main thread being blocked by the synchronous render phase — verified by
// screencast, the only source of frames that does not depend on that thread.
//
// Acknowledged blind spot: the overlay's appearance (colors, centering) cannot
// be checked from here — visual check.

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import crypto from "node:crypto";

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
const frames = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.method === "Page.screencastFrame") {
    frames.push({
      t: Date.now(),
      hash: crypto.createHash("sha1").update(msg.params.data).digest("hex").slice(0, 12),
    });
    send("Page.screencastFrameAck", { sessionId: msg.params.sessionId });
    return;
  }
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
async function evaluate(expr, awaitPromise = true) {
  const r = await send("Runtime.evaluate", {
    expression: expr,
    awaitPromise,
    returnByValue: true,
  });
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
  return r.result?.result?.value;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => JSON.stringify(String(s));

let failures = 0;
function check(name, cond, detail = "") {
  console.log(`${cond ? "OK " : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!cond) failures++;
}

// --- Fixtures ------------------------------------------------------------- //
// The large document must exceed the `beforeHeavyRender` threshold (60,000
// characters) AND last long enough for the overlay to show: the formulas are
// what costs, KaTeX producing ~20× their source in DOM.
const dir = mkdtempSync(join(tmpdir(), "kd-loading-"));
const gros = [];
for (let i = 0; i < 400; i++) {
  gros.push(`## Section ${i}`, "");
  gros.push(`Texte de la section ${i} avec une formule inline $\\sigma_{${i}}^2 = \\sum_{k=1}^{n} x_k^2$.`, "");
  gros.push("$$", `\\mathbb{E}\\left[ X_{${i}} \\right] = \\int_0^\\infty t^{${i % 7}} e^{-t}\\,dt`, "$$", "");
}
writeFileSync(join(dir, "gros.md"), gros.join("\n"), "utf8");
writeFileSync(join(dir, "petit.md"), "# Petit\n\nUne ligne, une formule $a^2+b^2=c^2$.\n", "utf8");

const INSTRUMENT = `(() => {
  const L = (window.__L = { events: [], errors: [], t0: 0 });
  addEventListener("error", (e) => L.errors.push(String(e.message || e.error)));
  const ov = document.getElementById("loading-overlay");
  if (!ov) return "absent";
  new MutationObserver(() => L.events.push({ visible: !ov.hidden, t: performance.now() }))
    .observe(ov, { attributes: true, attributeFilter: ["hidden"] });
  L.reset = () => { L.events = []; L.t0 = performance.now(); };
  L.reset();
  return "ok";
})()`;

/** Plays `action` in the page and returns the overlay transitions it causes. */
async function probe(action, attente = 12000) {
  await evaluate(`window.__L.reset(), "ok"`);
  const r = await evaluate(`(async () => {
    const L = window.__L;
    ${action}
    const deadline = performance.now() + ${attente};
    while (performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
      const last = L.events[L.events.length - 1];
      if (last && !last.visible) break;
      if (!L.events.length && performance.now() - L.t0 > 3500) break;
    }
    await new Promise((r) => setTimeout(r, 250));
    return {
      events: L.events.map((e) => ({ v: e.visible, t: Math.round(e.t - L.t0) })),
      hidden: document.getElementById("loading-overlay").hidden,
      errors: L.errors.slice(),
      source: !!document.querySelector(".source-view"),
      katex: document.querySelectorAll(".katex").length,
    };
  })()`);
  const shown = r.events.find((e) => e.v);
  const hid = [...r.events].reverse().find((e) => !e.v);
  return { ...r, shownAt: shown ? shown.t : null, hiddenAt: hid ? hid.t : null };
}

const closeMine = () => evaluate(`(async () => {
  const st = await window.__TAURI__.core.invoke('get_window_state');
  for (const t of st.tabs) {
    if (t.title === 'gros.md' || t.title === 'petit.md') {
      await window.__TAURI__.core.invoke('close_tab', { docId: t.id });
    }
  }
})()`).catch(() => {});

try {
  check("overlay present in the DOM", (await evaluate(INSTRUMENT)) === "ok");

  // 1. Large document: the overlay must go up then come down.
  let r = await probe(`window.__TAURI__.core.invoke('open_link', { baseDir: ${esc(dir)}, href: 'gros.md' });`);
  check("large document: overlay shown", r.shownAt !== null, `at ${r.shownAt} ms`);
  check("large document: overlay removed afterwards", r.hidden === true, `removed at ${r.hiddenAt} ms`);
  check("large document: render completed", r.katex > 500, `${r.katex} formulas`);

  // 2. Source view: fast, no overlay must flicker.
  r = await probe(`document.getElementById('btn-source-toggle').click();`);
  check("switch → source: no overlay", r.shownAt === null);
  check("switch → source: source view active", r.source === true);

  // 3. Back to preview: full pipeline, overlay expected.
  r = await probe(`document.getElementById('btn-source-toggle').click();`);
  check("switch → preview: overlay shown", r.shownAt !== null, `at ${r.shownAt} ms`);
  check("switch → preview: overlay removed afterwards", r.hidden === true);

  // 4. Small document: under the anti-flash delay.
  await closeMine();
  r = await probe(`window.__TAURI__.core.invoke('open_link', { baseDir: ${esc(dir)}, href: 'petit.md' });`, 4000);
  check("small document: no overlay", r.shownAt === null);
  check("no JS errors", r.errors.length === 0, r.errors.join(" | "));

  // 5. Does the animation survive the main thread being blocked? `getComputedStyle`
  //    cannot answer (it reads from that thread): we sample the screen
  //    by screencast, fed by the compositor.
  await closeMine();
  await evaluate(`document.getElementById('loading-overlay').hidden = false, "ok"`);
  await sleep(400);
  await send("Page.enable", {});
  await send("Page.startScreencast", { format: "png", quality: 60, everyNthFrame: 1 });
  await sleep(600);
  const t0 = Date.now();
  evaluate(`(() => { const fin = performance.now() + 900; let x = 0;
    while (performance.now() < fin) x += Math.sqrt(x + 1); return x; })()`, false);
  await sleep(900);
  const pendant = frames.filter((f) => f.t > t0 + 60 && f.t < Date.now());
  const distincts = new Set(pendant.map((f) => f.hash)).size;
  await send("Page.stopScreencast", {});
  await evaluate(`document.getElementById('loading-overlay').hidden = true, "ok"`);
  check("spinner animated while the main thread is blocked", distincts >= 3,
    `${distincts} distinct images out of ${pendant.length} frames`);
} finally {
  await closeMine();
  await evaluate(`document.getElementById('loading-overlay').hidden = true, "ok"`).catch(() => {});
  rmSync(dir, { recursive: true, force: true });
}

console.log(failures === 0 ? "\nALL TESTS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
