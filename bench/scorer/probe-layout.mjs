// Characterises bpmn-auto-layout@2.0.0-alpha.2 against the real corpus.
//
// The red-team flagged layout as the single highest-risk component. This measures it:
// strip all DI from each file, run layout, and check DI COVERAGE — every semantic
// element that needs a shape or edge must have got one. Silent partial layout is the
// failure mode that ships broken diagrams, so coverage is the gate, not "no exception".
import { BpmnModdle } from 'bpmn-moddle';
import { layoutProcess } from 'bpmn-auto-layout';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, sep } from 'node:path';

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (extname(p) === '.bpmn') out.push(p);
  }
  return out;
}

const NEEDS_SHAPE = /^bpmn:(Start|End|Boundary|IntermediateCatch|IntermediateThrow)Event$|^bpmn:(User|Service|Script|Manual|Send|Receive|BusinessRule)?Task$|^bpmn:(Sub|AdHocSub)Process$|^bpmn:Transaction$|^bpmn:CallActivity$|^bpmn:(Exclusive|Parallel|Inclusive|EventBased|Complex)Gateway$|^bpmn:Participant$|^bpmn:Lane$|^bpmn:(DataObjectReference|DataStoreReference|TextAnnotation|Group)$/;
const NEEDS_EDGE = /^bpmn:(SequenceFlow|MessageFlow|Association|DataInputAssociation|DataOutputAssociation)$/;

function collect(root) {
  const seen = new Set(), shapes = new Set(), edges = new Set(), di = new Set();
  const stack = [root];
  while (stack.length) {
    const el = stack.pop();
    if (!el || typeof el !== 'object' || seen.has(el)) continue;
    seen.add(el);
    const t = el.$type;
    if (t && el.id) {
      if (NEEDS_SHAPE.test(t)) shapes.add(el.id);
      if (NEEDS_EDGE.test(t)) edges.add(el.id);
    }
    if (t === 'bpmndi:BPMNShape' || t === 'bpmndi:BPMNEdge') {
      if (el.bpmnElement?.id) di.add(el.bpmnElement.id);
    }
    for (const k of Object.keys(el)) {
      if (k === '$parent' || k === '$model' || k === '$descriptor') continue;
      const v = el[k];
      if (Array.isArray(v)) stack.push(...v);
      else if (v && typeof v === 'object') stack.push(v);
    }
  }
  return { shapes, edges, di };
}

async function stripDI(xml) {
  const moddle = new BpmnModdle();
  const { rootElement } = await moddle.fromXML(xml);
  rootElement.diagrams = [];
  const { xml: out } = await moddle.toXML(rootElement, { format: true });
  return out;
}

const p = (s, n) => String(s ?? '').padEnd(n);
const W = [30, 7, 7, 9, 9, 10, 30];
console.log(['file', 'shapes', 'edges', 'shape cov', 'edge cov', 'warnings', 'result'].map((h, i) => p(h, W[i])).join(''));
console.log('-'.repeat(W.reduce((a, b) => a + b, 0)));

const results = [];
for (const file of walk(process.argv[2] || 'bench/corpus')) {
  const short = file.split(sep).join('/').replace('bench/corpus/', '');
  const xml = readFileSync(file, 'utf8');
  let row = { file: short };
  try {
    const semanticOnly = await stripDI(xml);
    const res = await layoutProcess(semanticOnly);
    const out = typeof res === 'string' ? res : res.xml;
    row.warnings = typeof res === 'object' && res.warnings ? res.warnings.length : 'n/a';
    const moddle = new BpmnModdle();
    const { rootElement } = await moddle.fromXML(out);
    const { shapes, edges, di } = collect(rootElement);
    row.shapes = shapes.size;
    row.edges = edges.size;
    row.shapeCov = shapes.size ? [...shapes].filter((id) => di.has(id)).length / shapes.size : 1;
    row.edgeCov = edges.size ? [...edges].filter((id) => di.has(id)).length / edges.size : 1;
    row.missing = [...shapes, ...edges].filter((id) => !di.has(id));
    row.result = row.shapeCov === 1 && row.edgeCov === 1 ? 'COMPLETE' : `INCOMPLETE (${row.missing.length} missing)`;
  } catch (e) {
    row.result = `CRASH: ${e.constructor.name} ${e.message.slice(0, 40)}`;
  }
  results.push(row);
  const pct = (v) => (v === undefined ? '-' : `${Math.round(v * 100)}%`);
  console.log([row.file, row.shapes, row.edges, pct(row.shapeCov), pct(row.edgeCov), row.warnings, row.result].map((v, i) => p(v, W[i])).join(''));
}

const complete = results.filter((r) => r.result === 'COMPLETE').length;
const crashed = results.filter((r) => String(r.result).startsWith('CRASH')).length;
const partial = results.length - complete - crashed;
console.log(`\n${results.length} files | complete ${complete} | INCOMPLETE (silent data loss) ${partial} | CRASH ${crashed}`);
if (partial) {
  console.log('\nElements that got no DI:');
  for (const r of results.filter((x) => x.missing?.length)) console.log(`  ${r.file}: ${r.missing.slice(0, 8).join(', ')}${r.missing.length > 8 ? ` … +${r.missing.length - 8}` : ''}`);
}
