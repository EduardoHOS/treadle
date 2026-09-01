import { scoreAll, xsdValid, lintClean } from './gates.mjs';
import { readFileSync } from 'node:fs';
const f = 'bench/corpus/handmade/zeebe-roundtrip.bpmn';
const xml = readFileSync(f, 'utf8');
console.log('xsd :', JSON.stringify(await xsdValid(xml)).slice(0, 400));
console.log('lint:', JSON.stringify(await lintClean(xml)).slice(0, 400));
const edited = xml.replace('name="Charge card"', 'name="Charge the card"');
const r = await scoreAll(xml, edited, { expectChangedIds: ['Charge'] });
console.log('score:', r.passed + '/' + r.of, JSON.stringify(r.gates.diffSanity), 'collateral ok:', r.gates.noCollateral.ok);
