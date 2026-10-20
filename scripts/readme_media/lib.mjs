// Mini-client CDP pour produire les médias du README (pilotage sans souris globale).
import { writeFileSync, mkdirSync } from "node:fs";

export const PORT = process.env.KD_CDP_PORT ?? "9333";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function connect(match = (t) => t.url === "http://tauri.localhost/") {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = targets.find((t) => t.type === "page" && match(t));
  if (!page) throw new Error("page introuvable : " + targets.map((t) => t.title).join(" | "));
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => ((ws.onopen = res), (ws.onerror = rej)));
  let nextId = 1;
  const pending = new Map();
  const listeners = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
    } else if (msg.method && listeners.has(msg.method)) {
      for (const f of listeners.get(msg.method)) f(msg.params);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const id = nextId++;
      pending.set(id, { res, rej });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const on = (m, f) => (listeners.has(m) || listeners.set(m, []), listeners.get(m).push(f));
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };
  return { ws, send, on, evaluate, close: () => ws.close() };
}

export async function viewport(c, width, height, scale = 1) {
  await c.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false });
  await sleep(400);
}

export async function shot(c, file, clip) {
  const p = { format: "png", captureBeyondViewport: false };
  if (clip) p.clip = { ...clip, scale: 1 };
  const r = await c.send("Page.captureScreenshot", p);
  writeFileSync(file, Buffer.from(r.data, "base64"));
}

// Enregistre via screencast : frames PNG + durées -> fichier concat ffmpeg.
export async function record(c, dir, fn, { maxWidth = 1600, maxHeight = 1000 } = {}) {
  mkdirSync(dir, { recursive: true });
  const frames = [];
  c.on("Page.screencastFrame", async (p) => {
    frames.push({ data: p.data, t: p.metadata.timestamp });
    c.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
  });
  await c.send("Page.startScreencast", { format: "png", maxWidth, maxHeight, everyNthFrame: 1 });
  await sleep(300);
  await fn();
  await sleep(400);
  await c.send("Page.stopScreencast");
  frames.push({ data: frames.at(-1).data, t: frames.at(-1).t + 1.5 }); // tenue finale
  let concat = "";
  frames.forEach((f, i) => {
    const name = `f${String(i).padStart(4, "0")}.png`;
    writeFileSync(`${dir}/${name}`, Buffer.from(f.data, "base64"));
    if (i < frames.length - 1) {
      concat += `file '${name}'\nduration ${Math.max(0.02, frames[i + 1].t - f.t).toFixed(3)}\n`;
    } else concat += `file '${name}'\n`;
  });
  writeFileSync(`${dir}/list.txt`, concat);
  return frames.length;
}

// Souris CDP (coordonnées CSS du viewport) avec trajectoire interpolée.
export async function mouseMove(c, x0, y0, x1, y1, steps = 20, ms = 15, extra = {}) {
  for (let i = 1; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps, y = y0 + ((y1 - y0) * i) / steps;
    await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, ...extra });
    await sleep(ms);
  }
}
export async function click(c, x, y) {
  for (const type of ["mousePressed", "mouseReleased"])
    await c.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
}
export async function key(c, keyName, code, vk, modifiers = 0, text) {
  await c.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key: keyName, code, windowsVirtualKeyCode: vk, modifiers, text });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: keyName, code, windowsVirtualKeyCode: vk, modifiers });
}
export async function type(c, s, ms = 70) {
  for (const ch of s) {
    await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch });
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    await sleep(ms);
  }
}
