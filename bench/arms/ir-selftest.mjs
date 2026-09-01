// Proves the IR round-trips and that each patch op does exactly what it says,
// scored by the same gates the bake-off uses. If this fails, Arm C is not testable.
import { parse, serialize, project, applyPatch } from './ir.mjs';
import { scoreAll } from '../scorer/gates.mjs';
import { readFileSync } from 'node:fs';

const F = 'bench/corpus/handmade/zeebe-roundtrip.bpmn';
const original = readFileSync(F, 'utf8');

async function normalized() {
  const doc = await parse(original);
  return { doc, xml: await serialize(doc) };
}

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}: ${e.message}`); fail++; }
}
const assert = (c, m) => { if (!c) throw new Error(m); };

console.log('IR projection');
{
  const { doc } = await normalized();
  const ir = project(doc.definitions);
  await check('projects every flow node', () => assert(ir.nodes.length === 4, `got ${ir.nodes.length}`));
  await check('projects flows with endpoints', () => assert(ir.flows.length === 3 && ir.flows.every((f) => f.from && f.to), JSON.stringify(ir.flows)));
  await check('carries original ids verbatim', () => assert(ir.nodes.some((n) => n.id === 'Charge'), JSON.stringify(ir.nodes.map((n) => n.id))));
  await check('maps typed tasks', () => assert(ir.nodes.find((n) => n.id === 'Charge').type === 'service' && ir.nodes.find((n) => n.id === 'Review').type === 'user'));
  await check('surfaces extensions without lowering them', () => assert(ir.nodes.find((n) => n.id === 'Charge').ext.includes('zeebe:taskDefinition')));
  await check('emits no coordinates', () => assert(!JSON.stringify(ir).includes('Bounds') && !JSON.stringify(ir).includes('"x"')));
  const irTokens = Math.ceil(JSON.stringify(ir).length / 4);
  const xmlTokens = Math.ceil(original.length / 4);
  console.log(`       IR ~${irTokens} tok vs XML ~${xmlTokens} tok (${(xmlTokens / irTokens).toFixed(1)}x)`);
}

console.log('\npatch: set');
{
  const { doc, xml } = await normalized();
  applyPatch(doc, [{ op: 'set', id: 'Charge', patch: { name: 'Charge the card' } }]);
  const after = await serialize(doc);
  const r = await scoreAll(xml, after, { expectChangedIds: ['Charge'] });
  await check('renames and nothing else', () => assert(r.gates.noCollateral.ok, JSON.stringify(r.gates.noCollateral.unexpected)));
  await check('diff is one line, no shapes moved', () => assert(r.gates.diffSanity.addedLines === 1 && r.gates.diffSanity.shapesMoved === 0, JSON.stringify(r.gates.diffSanity)));
  await check('still valid', () => assert(r.gates.xsdValid.ok && r.gates.lintClean.correctness.ok));
}

console.log('\npatch: add with splice sugar');
{
  const { doc, xml } = await normalized();
  const { created } = applyPatch(doc, [
    { op: 'add', type: 'user', name: 'Verify identity', in: 'Payment', id: 'Verify', between: ['Charge', 'Review'] },
  ]);
  const after = await serialize(doc);
  const ir = project(doc.definitions);
  await check('inserts the node', () => assert(ir.nodes.some((n) => n.id === 'Verify' && n.type === 'user')));
  await check('rewires Charge -> Verify', () => assert(ir.flows.some((f) => f.from === 'Charge' && f.to === 'Verify'), JSON.stringify(ir.flows)));
  await check('adds Verify -> Review', () => assert(ir.flows.some((f) => f.from === 'Verify' && f.to === 'Review'), JSON.stringify(ir.flows)));
  await check('leaves no node orphaned', () => {
    const touched = new Set(ir.flows.flatMap((f) => [f.from, f.to]));
    const orphans = ir.nodes.filter((n) => !touched.has(n.id));
    assert(orphans.length === 0, `orphans: ${orphans.map((o) => o.id)}`);
  });
  const r = await scoreAll(xml, after, { expectChangedIds: [...created, 'Verify', 'Flow_2'] });
  await check('xsd-valid after insert', () => assert(r.gates.xsdValid.ok, JSON.stringify(r.gates.xsdValid.errors)));
  await check('correctness-clean after insert', () => assert(r.gates.lintClean.correctness.ok, JSON.stringify(r.gates.lintClean.correctness.errors)));
  await check('no existing shape moved', () => assert(r.gates.diffSanity.shapesMoved === 0, JSON.stringify(r.gates.diffSanity)));
}

console.log('\npatch: add boundary event');
{
  const { doc } = await normalized();
  applyPatch(doc, [{ op: 'add', type: 'boundary', name: 'Timeout', in: 'Payment', id: 'Timeout', on: 'Charge', event: 'timer' }]);
  const ir = project(doc.definitions);
  const bnd = ir.nodes.find((n) => n.id === 'Timeout');
  await check('attaches to its host', () => assert(bnd?.on === 'Charge', JSON.stringify(bnd)));
  await check('carries the timer definition', () => assert(bnd?.event === 'timer', JSON.stringify(bnd)));
  await check('xsd-valid', async () => assert((await scoreAll(await serialize(doc), await serialize(doc), {})).gates.xsdValid.ok));
}

console.log('\npatch: del cascades');
{
  const { doc } = await normalized();
  applyPatch(doc, [{ op: 'del', id: 'Review' }]);
  const ir = project(doc.definitions);
  await check('removes the node', () => assert(!ir.nodes.some((n) => n.id === 'Review')));
  await check('removes flows that touched it', () => assert(!ir.flows.some((f) => f.from === 'Review' || f.to === 'Review'), JSON.stringify(ir.flows)));
  await check('leaves no dangling flow refs', () => {
    const ids = new Set(ir.nodes.map((n) => n.id));
    const dangling = ir.flows.filter((f) => !ids.has(f.from) || !ids.has(f.to));
    assert(dangling.length === 0, JSON.stringify(dangling));
  });
}

console.log('\npatch: connect with condition');
{
  const { doc, xml } = await normalized();
  applyPatch(doc, [
    { op: 'add', type: 'xor', name: 'Charge ok?', in: 'Payment', id: 'Ok' },
    { op: 'connect', from: 'Ok', to: 'End_1', if: '=charged = false', name: 'declined' },
  ]);
  const ir = project(doc.definitions);
  const f = ir.flows.find((x) => x.from === 'Ok' && x.to === 'End_1');
  await check('creates the conditional flow', () => assert(f?.if === '=charged = false' && f.name === 'declined', JSON.stringify(f)));
  await check('xsd-valid', async () => assert((await scoreAll(xml, await serialize(doc), { expectChangedIds: ['Ok', f.id] })).gates.xsdValid.ok));
}

console.log('\npatch: errors are actionable');
{
  const { doc } = await normalized();
  for (const [op, want] of [
    [{ op: 'set', id: 'Nope', patch: { name: 'x' } }, 'not found'],
    [{ op: 'add', type: 'wormhole', in: 'Payment' }, 'unknown node type'],
    [{ op: 'connect', from: 'Charge', to: 'Nope' }, 'not found'],
  ]) {
    await check(`rejects ${JSON.stringify(op).slice(0, 40)}`, () => {
      try { applyPatch(doc, [op]); throw new Error('should have thrown'); }
      catch (e) { assert(e.message.includes(want), `message was "${e.message}"`); }
    });
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
