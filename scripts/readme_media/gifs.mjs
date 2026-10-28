// README GIFs: CDP screencast (fake cursor injected, CDP does not draw one).
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { connect, viewport, sleep, record, mouseMove, click, key, type } from "./lib.mjs";

const OUT = resolve("../../doc/media");
const W = 1100, H = 680;
const c = await connect();
await viewport(c, W, H, 1);

const CURSOR = `(()=>{if(document.getElementById('fake-cursor'))return;const d=document.createElement('div');d.id='fake-cursor';
d.innerHTML='<svg width="22" height="28" viewBox="0 0 22 28"><path d="M1 1 L1 22 L6.5 16.5 L10.5 26 L14 24.5 L10 15.5 L18 15.5 Z" fill="#fff" stroke="#000" stroke-width="1.6" stroke-linejoin="round"/></svg>';
d.style.cssText='position:fixed;left:-50px;top:-50px;z-index:2147483647;pointer-events:none;transition:transform .08s';
document.body.appendChild(d);
addEventListener('mousemove',e=>{d.style.left=e.clientX+'px';d.style.top=e.clientY+'px'},true);
addEventListener('mousedown',()=>d.style.transform='scale(.85)',true);addEventListener('mouseup',()=>d.style.transform='',true);})()`;
await c.evaluate(CURSOR);

const activate = async (name) => {
  await c.evaluate(`(()=>{const t=[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes(${JSON.stringify(name)})); return window.__TAURI__.core.invoke('activate_tab',{docId:Number(t.dataset.id)})})()`);
  await sleep(1500);
  await c.evaluate(CURSOR);
};
const rect = async (sel) => JSON.parse(await c.evaluate(`(()=>{const e=${sel};const b=e.getBoundingClientRect();return JSON.stringify({x:b.x+b.width/2,y:b.y+b.height/2})})()`));
let cur = { x: W / 2, y: H / 2 };
const moveTo = async (p, steps = 22) => { await mouseMove(c, cur.x, cur.y, p.x, p.y, steps, 16); cur = p; };
const clickAt = async (p) => { await moveTo(p); await sleep(150); await click(c, p.x, p.y); };

function toGif(dir, name, width = 960, fps = 15) {
  const pal = `${dir}/pal.png`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", `${dir}/list.txt`, "-vf", `fps=${fps},scale=${width}:-1:flags=lanczos,palettegen=stats_mode=diff`, pal]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", `${dir}/list.txt`, "-i", pal, "-lavfi", `fps=${fps},scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle`, `${OUT}/${name}.gif`]);
  rmSync(dir, { recursive: true, force: true });
}

const what = process.argv[2];
const TMP = resolve(process.env.TEMP ?? "/tmp", "kd_frames_" + what);

if (what === "latex") {
  await activate("paper.tex");
  await c.evaluate(`document.querySelectorAll('.doc-view').forEach(v=>v.scrollTop=0)`);
  await sleep(500);
  await record(c, TMP, async () => {
    await sleep(1200);
    const link = await rect(`[...document.querySelectorAll('.doc-view:not([hidden]) a[href^="#"]')].find(a=>/2\.1|\(2\)/.test(a.textContent) && a.getBoundingClientRect().top>200)`);
    await clickAt(link);
    await sleep(2200);
    const src = await rect(`document.getElementById('btn-source-toggle')`);
    await clickAt(src);
    await sleep(2600);
    await clickAt(src);
    await sleep(1800);
  });
  toGif(TMP, "latex");
}

if (what === "search") {
  await activate("hero.md");
  await record(c, TMP, async () => {
    await sleep(800);
    await key(c, "F", "KeyF", 70, 2 | 8);
    await sleep(500);
    await type(c, "order", 110);
    await sleep(1500);
    const hit = await rect(`[...document.querySelectorAll('#search-panel .search-hit')][3] || document.querySelector('#search-panel .search-hit')`);
    await clickAt(hit);
    await sleep(2500);
  });
  await key(c, "Escape", "Escape", 27);
  toGif(TMP, "search");
}

if (what === "live") {
  const file = resolve("live.md");
  const steps = [
    "flowchart LR\n    A[Write] --> B[Save]",
    "flowchart LR\n    A[Write] --> B[Save]\n    B --> C{Looks good?}",
    "flowchart LR\n    A[Write] --> B[Save]\n    B --> C{Looks good?}\n    C -->|no| A",
    "flowchart LR\n    A[Write] --> B[Save]\n    B --> C{Looks good?}\n    C -->|no| A\n    C -->|yes| D([Ship it])",
  ];
  const doc = (i) =>
    `# Live reload\n\nEdit the file in any editor and save: the view follows.\n\n` +
    "```mermaid\n" + steps[i] + "\n```\n\n" + `*Saved ${i + 1} / ${steps.length}*\n`;
  writeFileSync(file, doc(0));
  await c.evaluate(`window.__TAURI__.core.invoke('open_paths',{paths:[${JSON.stringify(file)}]})`);
  await sleep(2500);
  await c.evaluate(`document.getElementById('fake-cursor')?.remove()`);
  await viewport(c, W, 360, 1);
  await record(c, TMP, async () => {
    await sleep(1200);
    for (let i = 1; i < steps.length; i++) {
      writeFileSync(file, doc(i));
      await sleep(1800);
    }
    await sleep(1000);
  });
  toGif(TMP, "live-reload");
}

if (what === "plotly") {
  // The 3.28.0 binary does not embed vendor/plotly.min.js: inject it from the repo.
  const has = await c.evaluate(`typeof window.Plotly`);
  if (has === "undefined") {
    const code = readFileSync("../../ui/vendor/plotly.min.js", "utf8");
    await c.send("Runtime.evaluate", { expression: code + "\n;0" });
  }
  await activate("plotly.md");
  await c.evaluate(`document.getElementById('btn-refresh').click()`);
  await sleep(4000);
  await c.evaluate(CURSOR);
  await c.evaluate(`new Promise(r=>{const f=()=>document.querySelector('.doc-view:not([hidden]) .js-plotly-plot .gl-container canvas')?r(1):setTimeout(f,200);f()})`);
  await sleep(1500);
  const g = await rect(`document.querySelector('.doc-view:not([hidden]) .js-plotly-plot')`);
  console.log("plot", g);
  await record(c, TMP, async () => {
    await sleep(800);
    await moveTo({ x: g.x, y: g.y - 40 });
    await sleep(1200); // hover: tooltip
    await moveTo({ x: g.x + 60, y: g.y + 60 }, 15);
    await sleep(1200);
    const start = { x: g.x - 160, y: g.y + 80 };
    await moveTo(start);
    await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: start.x, y: start.y, button: "left", clickCount: 1 });
    await mouseMove(c, start.x, start.y, start.x + 260, start.y - 40, 45, 25, { button: "left", buttons: 1 });
    await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: start.x + 260, y: start.y - 40, button: "left", clickCount: 1 });
    cur = { x: start.x + 260, y: start.y - 40 };
    await sleep(800);
    await moveTo({ x: g.x + 20, y: g.y - 20 });
    await sleep(1500);
  });
  toGif(TMP, "plotly");
}

if (what === "zoom") {
  await activate("gallery.md");
  await c.evaluate(`(()=>{const e=[...document.querySelectorAll('.doc-view:not([hidden]) .kroki-diagram')].find(e=>e.dataset.krokiType==='c4plantuml');e.scrollIntoView({block:'start'});document.querySelector('.doc-view:not([hidden])').scrollTop-=20})()`);
  await sleep(800);
  const t = await rect(`[...document.querySelectorAll('.doc-view:not([hidden]) .kroki-diagram')].find(e=>e.dataset.krokiType==='c4plantuml').querySelector('svg')`);
  await record(c, TMP, async () => {
    await sleep(900);
    const p = { x: t.x, y: t.y - 40 };
    await moveTo(p);
    await sleep(400);
    for (let i = 0; i < 9; i++) {
      await c.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: p.x, y: p.y, deltaX: 0, deltaY: -100, modifiers: 8 });
      await sleep(180);
    }
    await sleep(1600);
    await moveTo({ x: p.x + 10, y: p.y + 140 });
    await sleep(900);
    await key(c, "0", "Digit0", 48, 2, undefined);
    await sleep(1500);
  });
  toGif(TMP, "page-zoom");
}
c.close();
