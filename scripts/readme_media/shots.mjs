// Static captures: hero (light/dark) + gallery tiles.
import { connect, viewport, shot, sleep } from "./lib.mjs";
const OUT = "raw"; // raw captures, composed by compose.py
const c = await connect();
const activate = async (name) => {
  await c.evaluate(`(()=>{const t=[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes(${JSON.stringify(name)})); return window.__TAURI__.core.invoke('activate_tab',{docId:Number(t.dataset.id)})})()`);
  await sleep(1500);
};
const waitRendered = () =>
  c.evaluate(`new Promise(r=>{const t0=Date.now();const f=()=>{const v=document.querySelector('.doc-view:not([hidden])')||document;const d=[...document.querySelectorAll('.kroki-diagram')].filter(e=>e.offsetParent);if((d.length&&d.every(e=>e.classList.contains('ok')||e.querySelector('.diagram-error,pre')))||Date.now()-t0>20000)r(d.length);else setTimeout(f,200)};f()})`);
const setTheme = async (mode) => {
  await c.evaluate(`import('/js/theme.js').then(m=>m.applyTheme(${JSON.stringify(mode)}))`);
  await c.evaluate(`document.getElementById('btn-refresh').click()`);
  await sleep(2500);
  await waitRendered();
  await sleep(800);
};
const what = process.argv[2] ?? "hero";
if (what === "hero") {
  await viewport(c, 1280, 800, 1.5);
  await activate("hero.md");
  for (const mode of ["light", "dark"]) {
    await setTheme(mode);
    await c.evaluate(`document.querySelectorAll('.doc-view').forEach(v=>v.scrollTop=0)`);
    await sleep(300);
    await shot(c, `${OUT}/raw-hero-${mode}.png`);
  }
  await setTheme("light");
}
if (what === "gallery") {
  await viewport(c, 1280, 800, 2);
  await activate("gallery.md");
  await sleep(2500);
  await c.evaluate(`(()=>{const st=document.createElement('style');st.textContent='.doc-view *:not(svg *){border-color:transparent!important;box-shadow:none!important;background-color:transparent!important}';document.head.appendChild(st)})()`);
  console.log("rendered", await waitRendered());
  const boxes = JSON.parse(await c.evaluate(`JSON.stringify([...document.querySelectorAll('.kroki-diagram')].filter(e=>e.offsetParent).map(e=>({type:e.dataset.krokiType, ok:e.classList.contains('ok'), err: e.classList.contains('ok')?'':e.textContent.slice(0,150)})))`));
  console.log(boxes);
  for (let i = 0; i < boxes.length; i++) {
    const r = JSON.parse(await c.evaluate(`(()=>{const e=[...document.querySelectorAll('.kroki-diagram')].filter(e=>e.offsetParent)[${i}]; e.scrollIntoView({block:'start'}); const s=e.querySelector('svg')||e; const b=s.getBoundingClientRect(); return JSON.stringify({x:b.x,y:b.y,w:b.width,h:b.height})})()`));
    await sleep(300);
    const r2 = JSON.parse(await c.evaluate(`(()=>{const e=[...document.querySelectorAll('.kroki-diagram')].filter(e=>e.offsetParent)[${i}]; const s=e.querySelector('svg')||e; const b=s.getBoundingClientRect(); return JSON.stringify({x:b.x,y:b.y,w:b.width,h:b.height})})()`));
    const pad = 2;
    await shot(c, `${OUT}/raw-tile-${String(i).padStart(2, "0")}-${boxes[i].type}.png`, { x: Math.max(0, r2.x - pad), y: Math.max(0, r2.y - pad), width: Math.min(r2.w + 2 * pad, 1280), height: Math.min(r2.h + 2 * pad, 800) });
  }
}
c.close();
