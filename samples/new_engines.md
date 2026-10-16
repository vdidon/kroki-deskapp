# New engines: d2, dbml, bpmn

Three engines added to the built-in rendering (still no server or Docker).

## d2 (official WASM)

```d2
direction: right
md: .md file
app: Kroki Desk
eng: Built-in engine
svg: SVG

md -> app: drag & drop
app -> eng: code block
eng -> svg: rendering
```

```d2
server: {
  shape: cylinder
}
client -> server: request
server -> client: response
```

## dbml (database schema → DOT → embedded graphviz)

```dbml
Table users {
  id int [pk]
  name varchar
  role_id int
}

Table roles {
  id int [pk]
  name varchar
}

Ref: users.role_id > roles.id
```

## bpmn (bpmn-js, headless rendering)

The BPMN source must include the diagram information (`BPMNDiagram`/`DI`),
like any Camunda / bpmn.io export.

```bpmn
<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Defs_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_1" isExecutable="false">
    <bpmn:startEvent id="Start_1" name="Start"/>
    <bpmn:task id="Task_1" name="Render the diagram"/>
    <bpmn:endEvent id="End_1" name="End"/>
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
</bpmn:definitions>
```
