// Diagnostic for the layout coverage failures: WHICH element types get no DI,
// and does the failure depend on how DI was stripped? Runs three input variants
// so we can tell a real layouter gap from an artefact of our own preprocessing.
import { BpmnModdle } from 'bpmn-moddle';
import { layoutProcess } from 'bpmn-auto-layout';
import { readFileSync } from 'node:fs';

const NEEDS_SHAPE = /^bpmn:(Start|End|Boundary|IntermediateCatch|IntermediateThrow)Event$|^bpmn:(User|Service|Script|Manual|Send|Receive|BusinessRule)?Task$|^bpmn:(Sub|AdHocSub)Process$|^bpmn:Transaction$|^bpmn:CallActivity$|^bpmn:(Exclusive|Parallel|Inclusive|EventBased|Complex)Gateway$|^bpmn:Participant$|^bpmn:Lane$|^bpmn:(DataObjectReference|DataStoreReference|TextAnnotation|Group)$/;
const NEEDS_EDGE = /^bpmn:(SequenceFlow|MessageFlow|Association|DataInputAssociation|DataOutputAssociation)$/;

function collect(root) {
  const seen = new Set(), need = new Map(), di = new Set();
  const stack = [root];
  while (stack.length) {
    const el = stack.pop();
    if (!el || typeof el !== 'object' || seen.has(el)) continue;
    seen.add(el);
    const t = el.$type;
    if (t && el.id && (NEEDS_SHAPE.test(t) || NEEDS_EDGE.test(t))) need.set(el.id, t);
    if ((t === 'bpmndi:BPMNShape' || t === 'bpmndi:BPMNEdge') && el.bpmnElement?.id) di.add(el.bpmnElement.id);
    for (const k of Object.keys(el)) {
      if (k === '$parent' || k === '$model' || k === '$descriptor') continue;
      const v = el[k];
      if (Array.isArray(v)) stack.push(...v);
      else if (v && typeof v === 'object') stack.push(v);
    }
  }
  return { need, di };
}

async function variant(xml, mode) {
  const moddle = new BpmnModdle();
  const { rootElement } = await moddle.fromXML(xml);
  if (mode === 'strip') rootElement.diagrams = [];
  const { xml: out } = await moddle.toXML(rootElement, { format: true });
  return mode === 'raw' ? xml : out;
}

for (const file of process.argv.slice(2)) {
  console.log(`\n=== ${file}`);
  for (const mode of ['raw', 'normalized', 'strip']) {
    let line = `  ${mode.padEnd(11)} `;
    try {
      const input = await variant(readFileSync(file, 'utf8'), mode);
      const res = await layoutProcess(input);
      const out = typeof res === 'string' ? res : res.xml;
      const warns = typeof res === 'object' && res.warnings ? res.warnings : [];
      const moddle = new BpmnModdle();
      const { rootElement } = await moddle.fromXML(out);
      const { need, di } = collect(rootElement);
      const missing = [...need].filter(([id]) => !di.has(id));
      const byType = missing.reduce((a, [, t]) => ((a[t] = (a[t] || 0) + 1), a), {});
      line += `${need.size - missing.length}/${need.size} covered`;
      line += missing.length ? `  MISSING ${JSON.stringify(byType)}` : '  COMPLETE';
      if (warns.length) line += `  warnings=${JSON.stringify(warns.slice(0, 2).map((w) => w.code || w.message || w))}`;
      console.log(line);
    } catch (e) {
      console.log(line + `CRASH ${e.constructor.name}: ${e.message.slice(0, 70)}`);
    }
  }
}
