// Which bpmnlint preset is a fair gate? Runs each preset over the MIWG reference
// models that are NOT already clean, so we can tell a correctness violation from a
// style opinion. A gate that the OMG's own reference models fail is a style gate.
import { lintClean } from './gates.mjs';
import { readFileSync } from 'node:fs';

const FILES = ['A.2.1', 'A.3.0', 'A.4.0', 'B.1.0', 'B.2.0', 'C.2.0', 'C.3.0', 'C.5.0', 'C.6.0', 'C.8.0', 'C.8.1', 'C.1.0'];

for (const preset of ['bpmnlint:correctness', 'bpmnlint:recommended', 'bpmnlint:all']) {
  let clean = 0, n = 0;
  const rules = {};
  for (const f of FILES) {
    n++;
    let r;
    try {
      r = await lintClean(readFileSync(`bench/corpus/miwg/${f}.bpmn`, 'utf8'), { config: { extends: preset } });
    } catch (e) {
      console.log(preset.padEnd(24), 'UNAVAILABLE:', e.message.slice(0, 80));
      break;
    }
    if (r.ok) clean++;
    for (const e of r.errors || []) rules[e.rule] = (rules[e.rule] || 0) + 1;
  }
  if (n) console.log(preset.padEnd(24), `clean ${clean}/${n}`, JSON.stringify(rules));
}
