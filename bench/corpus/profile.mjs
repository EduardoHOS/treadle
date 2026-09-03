// Profiles every .bpmn in the corpus from the parsed moddle tree (not regex),
// and measures moddle round-trip fidelity: semantic, byte-level, and idempotence.
//
// The byte-level column is the one that matters for Treadle's core promise:
// "we only rewrite what you asked us to change". moddle re-serializes the whole
// document, so byte-identity only holds when the file was written by a moddle-based
// tool in the first place (Camunda Modeler, bpmn-js, anything on bpmn.io).
import { BpmnModdle } from 'bpmn-moddle';
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

const FLOW_NODE = /^bpmn:(Start|End|Boundary|IntermediateCatch|IntermediateThrow)Event$|^bpmn:(User|Service|Script|Manual|Send|Receive|BusinessRule)?Task$|^bpmn:(Sub|AdHocSub)Process$|^bpmn:Transaction$|^bpmn:CallActivity$|^bpmn:(Exclusive|Parallel|Inclusive|EventBased|Complex)Gateway$/;

// Walks every moddle element reachable from the definitions root.
function tally(root) {
  const seen = new Set();
  const counts = {
    nodes: 0, flows: 0, pools: 0, lanes: 0, msgFlows: 0,
    sub: 0, boundary: 0, gateways: 0, shapes: 0, edges: 0, extensions: 0,
  };
  const stack = [root];
  while (stack.length) {
    const el = stack.pop();
    if (!el || typeof el !== 'object' || seen.has(el)) continue;
    seen.add(el);
    const t = el.$type;
    if (t) {
      if (FLOW_NODE.test(t)) counts.nodes++;
      if (t === 'bpmn:SequenceFlow') counts.flows++;
      if (t === 'bpmn:Participant') counts.pools++;
      if (t === 'bpmn:Lane') counts.lanes++;
      if (t === 'bpmn:MessageFlow') counts.msgFlows++;
      if (t === 'bpmn:SubProcess' || t === 'bpmn:AdHocSubProcess') counts.sub++;
      if (t === 'bpmn:BoundaryEvent') counts.boundary++;
      if (t.endsWith('Gateway')) counts.gateways++;
      if (t === 'bpmndi:BPMNShape') counts.shapes++;
      if (t === 'bpmndi:BPMNEdge') counts.edges++;
      if (t === 'bpmn:ExtensionElements') counts.extensions++;
    }
    for (const k of Object.keys(el)) {
      if (k === '$parent' || k === '$model' || k === '$descriptor') continue;
      const v = el[k];
      if (Array.isArray(v)) stack.push(...v);
      else if (v && typeof v === 'object') stack.push(v);
    }
  }
  return counts;
}

const rows = [];
for (const file of walk(process.argv[2] || 'bench/corpus')) {
  const xml = readFileSync(file, 'utf8');
  const moddle = new BpmnModdle();
  const r = { file: file.split(sep).join('/').replace('bench/corpus/', ''), bytes: xml.length };
  const exporter = xml.match(/exporter="([^"]*)"/);
  r.exporter = exporter ? exporter[1] : '';
  r.vendorExt = xml.match(/(camunda|zeebe|activiti|flowable|signavio):[a-z]/i)?.[1] ?? '-';
  try {
    const { rootElement, warnings } = await moddle.fromXML(xml);
    Object.assign(r, tally(rootElement));
    r.warn = warnings.length;
    const { xml: out } = await moddle.toXML(rootElement, { format: true });
    r.byteIdentical = out.trim() === xml.trim();
    const { rootElement: r2 } = await moddle.fromXML(out);
    const { xml: out2 } = await moddle.toXML(r2, { format: true });
    r.stable = out2 === out;
    // semantic identity: re-tally the reparsed tree and compare
    const t2 = tally(r2);
    r.semanticSame = JSON.stringify(t2) === JSON.stringify(tally(rootElement));
  } catch (e) {
    r.error = e.message.slice(0, 90);
  }
  rows.push(r);
}

rows.sort((a, b) => (a.nodes || 0) - (b.nodes || 0));
const p = (s, n) => String(s ?? '').padEnd(n);
const H = ['file', 'bytes', 'node', 'flow', 'pool', 'lane', 'mf', 'sub', 'bnd', 'gw', 'shape', 'edge', 'ext', 'vend', 'warn', 'byte=', 'sem=', 'idem'];
const W = [30, 8, 5, 5, 5, 5, 4, 4, 4, 4, 6, 5, 4, 9, 5, 6, 5, 5];
console.log(H.map((h, i) => p(h, W[i])).join(''));
console.log('-'.repeat(W.reduce((a, b) => a + b, 0)));
for (const r of rows) {
  if (r.error) { console.log(p(r.file, 30), 'PARSE ERROR:', r.error); continue; }
  console.log([
    r.file, r.bytes, r.nodes, r.flows, r.pools, r.lanes, r.msgFlows, r.sub,
    r.boundary, r.gateways, r.shapes, r.edges, r.extensions, r.vendorExt,
    r.warn, r.byteIdentical ? 'YES' : 'no', r.semanticSame ? 'yes' : 'NO', r.stable ? 'yes' : 'NO',
  ].map((v, i) => p(v, W[i])).join(''));
}
const ok = rows.filter((r) => !r.error);
const bucket = (n) => (n < 15 ? 'small' : n < 50 ? 'medium' : 'large');
const strata = ok.reduce((a, r) => ((a[bucket(r.nodes)] = (a[bucket(r.nodes)] || 0) + 1), a), {});
console.log(`\n${rows.length} files | parse errors ${rows.length - ok.length} | byte-identical ${ok.filter((r) => r.byteIdentical).length}/${ok.length} | semantically identical ${ok.filter((r) => r.semanticSame).length}/${ok.length} | idempotent ${ok.filter((r) => r.stable).length}/${ok.length}`);
console.log(`strata (by flow-node count): ${JSON.stringify(strata)}`);
console.log(`with vendor extensions: ${ok.filter((r) => r.vendorExt !== '-').length}/${ok.length}`);
console.log('\nexporters seen:');
for (const [e, n] of Object.entries(ok.reduce((a, r) => ((a[r.exporter || '(none)'] = (a[r.exporter || '(none)'] || 0) + 1), a), {}))) {
  console.log(`  ${p(e, 44)} ${n}`);
}
