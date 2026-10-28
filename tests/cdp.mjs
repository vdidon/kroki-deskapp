// Test harness: drives the Kroki Desk webview through the CDP protocol.
// Usage: node cdp.mjs <port> <action> [page-title-filter]
// Actions: report | reorder | tear-cancel | invoke-detach | shot
// Prerequisite: launch the app with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>

const port = process.argv[2] ?? "9222";
const action = process.argv[3] ?? "report";
// invoke-detach-at: argv[4]=x argv[5]=y argv[6]=filter; otherwise argv[4]=filter
const isDetachAt = action === "invoke-detach-at";
const dropX = isDetachAt ? Number(process.argv[4]) : 0;
const dropY = isDetachAt ? Number(process.argv[5]) : 0;
const filter = (isDetachAt ? process.argv[6] : process.argv[4]) ?? "";

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const pages = targets.filter((t) => t.type === "page");
const page = filter.startsWith("#")
  ? pages[Number(filter.slice(1))]
  : filter
    ? pages.find((t) => t.title.includes(filter))
    : pages[0];
if (!page) {
  console.error(`page not found (filter="${filter}", pages=${pages.map((p) => p.title).join(" | ")})`);
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
  if (r.result?.exceptionDetails) {
    throw new Error(JSON.stringify(r.result.exceptionDetails));
  }
  return r.result?.result?.value;
}
async function mouse(type, x, y) {
  await send("Input.dispatchMouseEvent", {
    type,
    x,
    y,
    button: "left",
    buttons: type === "mouseReleased" ? 0 : 1,
    clickCount: type === "mousePressed" ? 1 : 0,
    pointerType: "mouse",
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function tabsInfo() {
  return evaluate(
    `(() => [...document.querySelectorAll('.tab')].map(t => { const r = t.getBoundingClientRect(); return { id: t.dataset.id, title: t.querySelector('.tab-title').textContent, x: r.x, y: r.y, w: r.width, h: r.height, active: t.classList.contains('active'), tearing: t.classList.contains('tearing') } }))()`,
  );
}

if (action === "report") {
  console.log(JSON.stringify({ page: page.title, tabs: await tabsInfo() }, null, 1));
} else if (action === "where") {
  // Window screen geometry + a physical point in the middle of its tab bar.
  const w = await evaluate(
    `(() => ({ sx: window.screenX, sy: window.screenY, dpr: window.devicePixelRatio, iw: innerWidth, ih: innerHeight, title: document.title }))()`,
  );
  const tab = { x: Math.round((w.sx + 160) * w.dpr), y: Math.round((w.sy + 20) * w.dpr) };
  console.log(JSON.stringify({ ...w, tabbarPointPhysical: tab }));
} else if (action === "reorder") {
  const tabs = await tabsInfo();
  if (tabs.length < 2) {
    console.log(JSON.stringify({ skip: "needs 2 tabs" }));
    process.exit(0);
  }
  const src = tabs[tabs.length - 1];
  const sx = src.x + src.w / 2;
  const sy = src.y + src.h / 2;
  const tx = tabs[0].x + 6;
  await mouse("mousePressed", sx, sy);
  await sleep(60);
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await mouse("mouseMoved", sx + ((tx - sx) * i) / steps, sy);
    await sleep(35);
  }
  await mouse("mouseReleased", tx, sy);
  await sleep(450);
  const after = await tabsInfo();
  console.log(
    JSON.stringify({
      before: tabs.map((t) => t.title),
      after: after.map((t) => t.title),
      moved: tabs[tabs.length - 1].title === after[0]?.title,
    }),
  );
} else if (action === "tear-cancel") {
  const tabs = await tabsInfo();
  const src = tabs[tabs.length - 1];
  const sx = src.x + src.w / 2;
  const sy = src.y + src.h / 2;
  await mouse("mousePressed", sx, sy);
  await sleep(60);
  for (const [mx, my] of [
    [sx + 4, sy + 8],
    [sx + 12, sy + 60],
    [sx + 24, sy + 180],
    [sx + 32, sy + 300],
  ]) {
    await mouse("mouseMoved", mx, my);
    await sleep(45);
  }
  const during = await tabsInfo();
  for (const [mx, my] of [
    [sx + 12, sy + 50],
    [sx + 4, sy],
  ]) {
    await mouse("mouseMoved", mx, my);
    await sleep(45);
  }
  const back = await tabsInfo();
  await mouse("mouseReleased", sx + 4, sy);
  await sleep(300);
  const after = await tabsInfo();
  console.log(
    JSON.stringify({
      tearingDuring: during.find((t) => t.id === src.id)?.tearing ?? null,
      tearingAfterReturn: back.find((t) => t.id === src.id)?.tearing ?? null,
      tabsAfter: after.map((t) => t.title),
    }),
  );
} else if (action === "focus") {
  const out = await evaluate(
    `window.__TAURI__.core.invoke('focus_window', { label: window.__TAURI__.webviewWindow.getCurrentWebviewWindow().label }).then(() => 'ok')`,
  );
  await sleep(300);
  console.log(JSON.stringify({ page: page.title, focus: out }));
} else if (action === "invoke-detach-at") {
  // Triggers the same logic as the pointerup of a real drag, with a supplied
  // release position (debug command, debug builds only).
  const tabs = await tabsInfo();
  const src = tabs[tabs.length - 1];
  // If the source window closes (its last tab is transferred), the IPC
  // response never comes back: the wait is bounded.
  const out = await Promise.race([
    evaluate(
      `window.__TAURI__.core.invoke('debug_finish_tab_drag_at', { docId: ${Number(src.id)}, x: ${dropX}, y: ${dropY} }).then(() => 'ok').catch(e => 'ERR:' + e)`,
    ),
    sleep(1500).then(() => "ok (source window closed)"),
  ]);
  console.log(JSON.stringify({ from: page.title, tab: src.title, at: [dropX, dropY], result: out }));
} else {
  console.error(`unknown action: ${action}`);
  process.exit(1);
}

ws.close();
process.exit(0);
