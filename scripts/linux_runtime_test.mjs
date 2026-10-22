// Test runtime des moteurs via l'API Kroki locale (rendu réel sous WebKitGTK).
// Lancé DANS le conteneur, l'app tournant en headless (Xvfb).
const BASE = process.env.KROKI_URL || "http://127.0.0.1:8442";

const VEGALITE = JSON.stringify({
  $schema: "https://vega.github.io/schema/vega-lite/v5.json",
  data: { values: [{ a: "A", b: 28 }, { a: "B", b: 55 }] },
  mark: "bar",
  encoding: { x: { field: "a", type: "nominal" }, y: { field: "b", type: "quantitative" } },
});

const BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1" name="Debut"/>
    <bpmn:task id="Task_1" name="Rendre"/>
    <bpmn:endEvent id="End_1" name="Fin"/>
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1"/>
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="End_1"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_1_di" bpmnElement="Start_1"><dc:Bounds x="160" y="100" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1"><dc:Bounds x="250" y="78" width="100" height="80"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_1_di" bpmnElement="End_1"><dc:Bounds x="412" y="100" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1"><di:waypoint x="196" y="118"/><di:waypoint x="250" y="118"/></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2"><di:waypoint x="350" y="118"/><di:waypoint x="412" y="118"/></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

// [type, source, famille] — famille pour le résumé
const cases = [
  ["svgbob", "  +--->\n  |", "native Rust"],
  ["pikchr", "box \"hello\"", "native Rust"],
  ["mermaid", "graph TD; A-->B; B-->C", "JS/WASM"],
  ["graphviz", "digraph { a -> b -> c }", "WASM"],
  ["d2", "a -> b -> c", "WASM (worker blob)"],
  ["dbml", "Table u {\n id int [pk]\n}\nTable r {\n id int [pk]\n}\nRef: u.id > r.id", "JS→DOT→WASM"],
  ["bpmn", BPMN, "JS offscreen"],
  ["vegalite", VEGALITE, "JS (expr interp)"],
  ["nomnoml", "[A] -> [B]", "JS/Canvas"],
];

let okCount = 0;
for (const [type, src, fam] of cases) {
  try {
    const r = await fetch(`${BASE}/${type}/svg`, { method: "POST", body: src });
    const txt = await r.text();
    const ok = r.ok && txt.includes("<svg");
    if (ok) okCount++;
    console.log(`${type.padEnd(9)} [${fam.padEnd(18)}]: ${ok ? "OK  " : "FAIL"} (HTTP ${r.status}, ${txt.length} chars)`);
    if (!ok) console.log("   →", txt.slice(0, 400).replace(/\s+/g, " "));
  } catch (e) {
    console.log(`${type.padEnd(9)} [${fam.padEnd(18)}]: network FAIL — ${e.message}`);
  }
}
console.log(`\nResult: ${okCount}/${cases.length} engines OK`);
process.exit(okCount === cases.length ? 0 : 2);
