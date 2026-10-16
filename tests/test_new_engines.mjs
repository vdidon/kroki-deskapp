// Teste les nouveaux moteurs (d2, dbml, bpmn) via l'API Kroki locale.
// Usage : lancer l'app, puis `node tests/test_new_engines.mjs`.
const BASE = process.env.KROKI_URL || "http://127.0.0.1:8442";

const D2 = `direction: right
md: Fichier .md
app: Kroki Desk
md -> app: drag & drop
app -> md: rendu`;

const DBML = `Table users {
  id int [pk]
  name varchar
  role_id int
}
Table roles {
  id int [pk]
  name varchar
}
Ref: users.role_id > roles.id`;

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

const DITAA = `+--------+   +---------+
| Client +-->| Serveur |
+--------+   +---------+`;

const ERD = `[Person]
*id
name
+location_id

[Location]
*id
city

Person *--1 Location`;

const EXCALIDRAW = JSON.stringify({
  type: "excalidraw",
  version: 2,
  source: "test",
  elements: [
    { type: "rectangle", x: 100, y: 100, width: 220, height: 90, id: "r1", backgroundColor: "#a5d8ff", fillStyle: "solid" },
    { type: "text", x: 130, y: 132, width: 160, height: 25, id: "t1", text: "Hello Kroki", fontSize: 20, fontFamily: 1 },
  ],
  appState: { viewBackgroundColor: "#ffffff" },
  files: {},
});

const cases = [
  ["d2", D2], ["dbml", DBML], ["bpmn", BPMN], ["ditaa", DITAA],
  ["erd", ERD], ["excalidraw", EXCALIDRAW],
];

for (const [type, src] of cases) {
  try {
    const r = await fetch(`${BASE}/${type}/svg`, { method: "POST", body: src });
    const txt = await r.text();
    const ok = r.ok && txt.includes("<svg");
    console.log(`${type.padEnd(6)} : ${ok ? "OK" : "ÉCHEC"}  (HTTP ${r.status}, ${txt.length} car.)`);
    if (!ok) console.log("   →", txt.slice(0, 300).replace(/\n/g, " "));
  } catch (e) {
    console.log(`${type.padEnd(6)} : ÉCHEC réseau — ${e.message}`);
  }
}
