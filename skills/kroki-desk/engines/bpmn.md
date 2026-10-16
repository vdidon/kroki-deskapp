# BPMN

**API ID**: `bpmn` | **Output**: SVG only | **Best for**: Formal business process documentation (powered by bpmn-js)

## Syntax

### Mandatory structure

```xml
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
             xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
             xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
             id="definitions" targetNamespace="http://example.com">
  <process id="proc" isExecutable="false">
    <!-- flow elements -->
  </process>
  <bpmndi:BPMNDiagram id="diagram">
    <bpmndi:BPMNPlane id="plane" bpmnElement="proc">
      <!-- shapes + edges REQUIRED -->
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>
```

### Flow elements

```xml
<!-- Events -->
<startEvent id="start" name="Start"/>
<endEvent id="end" name="End"/>
<intermediateCatchEvent id="catch"><timerEventDefinition/></intermediateCatchEvent>
<intermediateThrowEvent id="throw"><signalEventDefinition signalRef="sig1"/></intermediateThrowEvent>
<boundaryEvent id="err" attachedToRef="task1"><errorEventDefinition errorRef="e1"/></boundaryEvent>

<!-- Tasks -->
<task id="t1" name="Generic"/>
<userTask id="t2" name="Human Task"/>
<serviceTask id="t3" name="Auto Task"/>
<scriptTask id="t4" name="Script"><script>println('hi')</script></scriptTask>
<sendTask id="t5" name="Send"/>
<receiveTask id="t6" name="Receive"/>
<callActivity id="ca" name="Sub" calledElement="otherProcessId"/>

<!-- Sub-processes -->
<subProcess id="sp" name="Sub Process">
  <startEvent id="sp_start"/><endEvent id="sp_end"/>
  <sequenceFlow id="sp_f1" sourceRef="sp_start" targetRef="sp_end"/>
</subProcess>

<!-- Gateways -->
<exclusiveGateway id="xgw" name="XOR"/>
<parallelGateway id="pgw" name="AND"/>
<inclusiveGateway id="igw" name="OR"/>
<eventBasedGateway id="ebgw"/>

<!-- Sequences -->
<sequenceFlow id="f1" sourceRef="start" targetRef="t1"/>
<!-- With condition (exclusive/inclusive gateway) -->
<sequenceFlow id="f2" sourceRef="xgw" targetRef="t1">
  <conditionExpression>${approved == true}</conditionExpression>
</sequenceFlow>
```

### Event definitions (at definitions level)

```xml
<message id="msg1" name="InvoiceMessage"/>
<signal id="sig1" name="AlertSignal"/>
<error id="e1" name="PaymentError" errorCode="ERR_PAY"/>
<escalation id="esc1" name="Escalation1"/>
```

### Lanes and collaboration

```xml
<!-- Lanes in a simple process -->
<process id="proc">
  <laneSet id="ls1">
    <lane id="lane1" name="Sales">
      <flowNodeRef>task1</flowNodeRef>
      <flowNodeRef>start</flowNodeRef>
    </lane>
    <lane id="lane2" name="Finance">
      <flowNodeRef>task2</flowNodeRef>
      <flowNodeRef>end</flowNodeRef>
    </lane>
  </laneSet>
  <!-- elements referenced in the lanes -->
</process>

<!-- Collaboration (multiple pools) -->
<collaboration id="collab1">
  <participant id="p1" name="Company" processRef="proc1"/>
  <participant id="p2" name="Customer" processRef="proc2"/>
  <messageFlow id="mf1" sourceRef="sendTask1" targetRef="receiveTask2"/>
</collaboration>
<!-- BPMNPlane must reference the collaboration, not the process -->
<bpmndi:BPMNPlane bpmnElement="collab1">...</bpmndi:BPMNPlane>
```

### BPMNDiagram - Coordinates (REQUIRED)

```xml
<!-- Standard shape: task 100x80, event 36x36, gateway 50x50 -->
<bpmndi:BPMNShape id="t1_s" bpmnElement="t1">
  <dc:Bounds x="200" y="80" width="100" height="80"/>
</bpmndi:BPMNShape>

<!-- Horizontal pool -->
<bpmndi:BPMNShape id="p1_s" bpmnElement="p1" isHorizontal="true">
  <dc:Bounds x="48" y="60" width="600" height="250"/>
</bpmndi:BPMNShape>

<!-- Lane: x = pool.x + 30, same height as the pool -->
<bpmndi:BPMNShape id="lane1_s" bpmnElement="lane1" isHorizontal="true">
  <dc:Bounds x="78" y="60" width="570" height="125"/>
</bpmndi:BPMNShape>

<!-- Edge: waypoints from center to center -->
<bpmndi:BPMNEdge id="f1_e" bpmnElement="f1">
  <di:waypoint x="236" y="118"/>
  <di:waypoint x="350" y="118"/>
</bpmndi:BPMNEdge>

<!-- MessageFlow edge -->
<bpmndi:BPMNEdge id="mf1_e" bpmnElement="mf1">
  <di:waypoint x="300" y="100"/>
  <di:waypoint x="300" y="300"/>
</bpmndi:BPMNEdge>
```

## Gotchas

- **BPMNDiagram REQUIRED**: without the shapes/edges section, the diagram is empty or invalid
- **All flow elements** must have a matching BPMNShape/BPMNEdge
- **Lane in BPMNDiagram**: `isHorizontal="true"` required + `x = pool.x + 30` (pool label)
- **Collaboration**: BPMNPlane must reference the collaboration (`bpmnElement="collab1"`), not a process
- **Conditions**: `conditionExpression` without `xsi:type` works in bpmn-js
- **flowNodeRef**: must list ALL flow elements in the lane (start, end, tasks, gateways)
- **callActivity** : `calledElement` references the target process `id` (not the file)
- **boundaryEvent**: `attachedToRef` references the host task, its Shape must have `isInterrupting="true|false"`
- **Namespaces**: all 4 xmlns are required (`MODEL`, `DI`, `DC`, `bpmndi`)

## Example

```bpmn
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
             xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
             xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
             xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
             id="def1" targetNamespace="http://example.com">
  <process id="proc" isExecutable="false">
    <laneSet id="ls1">
      <lane id="lane1" name="Sales">
        <flowNodeRef>start</flowNodeRef>
        <flowNodeRef>task1</flowNodeRef>
        <flowNodeRef>xgw</flowNodeRef>
      </lane>
      <lane id="lane2" name="Finance">
        <flowNodeRef>task2</flowNodeRef>
        <flowNodeRef>task3</flowNodeRef>
        <flowNodeRef>end</flowNodeRef>
      </lane>
    </laneSet>
    <startEvent id="start" name="Order received"/>
    <userTask id="task1" name="Review order"/>
    <exclusiveGateway id="xgw" name="Approved?"/>
    <serviceTask id="task2" name="Process payment"/>
    <endEvent id="end" name="Done"/>
    <task id="task3" name="Reject order"/>
    <sequenceFlow id="f1" sourceRef="start" targetRef="task1"/>
    <sequenceFlow id="f2" sourceRef="task1" targetRef="xgw"/>
    <sequenceFlow id="f3" sourceRef="xgw" targetRef="task2">
      <conditionExpression>${approved == true}</conditionExpression>
    </sequenceFlow>
    <sequenceFlow id="f4" sourceRef="xgw" targetRef="task3">
      <conditionExpression>${approved == false}</conditionExpression>
    </sequenceFlow>
    <sequenceFlow id="f5" sourceRef="task2" targetRef="end"/>
    <sequenceFlow id="f6" sourceRef="task3" targetRef="end"/>
  </process>
  <bpmndi:BPMNDiagram id="diagram">
    <bpmndi:BPMNPlane id="plane" bpmnElement="proc">
      <bpmndi:BPMNShape id="lane1_s" bpmnElement="lane1" isHorizontal="true">
        <dc:Bounds x="78" y="60" width="622" height="120"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="lane2_s" bpmnElement="lane2" isHorizontal="true">
        <dc:Bounds x="78" y="180" width="622" height="120"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="start_s" bpmnElement="start">
        <dc:Bounds x="112" y="102" width="36" height="36"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="task1_s" bpmnElement="task1">
        <dc:Bounds x="210" y="80" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="xgw_s" bpmnElement="xgw">
        <dc:Bounds x="375" y="95" width="50" height="50"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="task2_s" bpmnElement="task2">
        <dc:Bounds x="490" y="200" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="task3_s" bpmnElement="task3">
        <dc:Bounds x="490" y="80" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="end_s" bpmnElement="end">
        <dc:Bounds x="632" y="222" width="36" height="36"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="f1_e" bpmnElement="f1">
        <di:waypoint x="148" y="120"/><di:waypoint x="210" y="120"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="f2_e" bpmnElement="f2">
        <di:waypoint x="310" y="120"/><di:waypoint x="375" y="120"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="f3_e" bpmnElement="f3">
        <di:waypoint x="400" y="145"/><di:waypoint x="400" y="240"/><di:waypoint x="490" y="240"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="f4_e" bpmnElement="f4">
        <di:waypoint x="425" y="120"/><di:waypoint x="490" y="120"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="f5_e" bpmnElement="f5">
        <di:waypoint x="590" y="240"/><di:waypoint x="632" y="240"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="f6_e" bpmnElement="f6">
        <di:waypoint x="590" y="120"/><di:waypoint x="650" y="120"/><di:waypoint x="650" y="222"/>
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>
```
