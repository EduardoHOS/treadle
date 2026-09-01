// Day-1 non-optional check: does bpmn-moddle round-trip Camunda 8 / Zeebe extensions unchanged?
import { BpmnModdle } from 'bpmn-moddle';
import { readFileSync, writeFileSync } from 'node:fs';

const file = process.argv[2];
const xml = readFileSync(file, 'utf8');
const moddle = new BpmnModdle();
const { rootElement, warnings } = await moddle.fromXML(xml);
const { xml: out } = await moddle.toXML(rootElement, { format: true });
writeFileSync(file + '.rt', out);

const probes = [
  'zeebe:taskDefinition', 'retries="3"', 'zeebe:ioMapping', '=order.total',
  'zeebe:taskHeaders', 'currency', 'zeebe:formDefinition', 'exception-form',
  'zeebe:assignmentDefinition', 'candidateGroups="finance"', 'zeebe:versionTag',
  'modeler:executionPlatform', 'exporterVersion', 'dc:Bounds', 'di:waypoint',
];
console.log('warnings:', warnings.length, warnings.map(w => w.message).join(' | '));
let lost = 0;
for (const p of probes) {
  const ok = out.includes(p);
  if (!ok) lost++;
  console.log(`${ok ? 'KEPT' : 'LOST'}  ${p}`);
}
console.log(`\nverdict: ${lost === 0 ? 'LOSSLESS' : lost + ' PROBE(S) LOST'}`);
console.log(`bytes in ${xml.length} -> out ${out.length}`);
