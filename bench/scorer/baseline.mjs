// Establishes the corpus floor: do the OMG reference models themselves pass our gates?
// If a MIWG reference file fails XSD or lint, the gate is too strict (or the file is
// genuinely non-conformant) — either way we must know before scoring any arm against it.
import { parses, xsdValid, lintClean } from './gates.mjs';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, sep } from 'node:path';
function walk(directory, files = []) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) walk(path, files);
    else if (extname(path) === '.bpmn') files.push(path);
  }
  return files;
}
const p = (s, n) => String(s ?? '').padEnd(n);
console.log(p('file', 30) + p('parse', 8) + p('xsd', 8) + p('lint', 8) + 'lint errors');
console.log('-'.repeat(90));
let px = 0, xx = 0, lx = 0, n = 0;
for (const f of walk(process.argv[2] || 'bench/corpus')) {
  const xml = readFileSync(f, 'utf8'); const short = f.split(sep).join('/').replace('bench/corpus/', ''); n++;
  const a = await parses(xml); const b = await xsdValid(xml); const c = await lintClean(xml, { config: { extends: 'bpmnlint:recommended' } });
  if (a.ok) px++; if (b.ok) xx++; if (c.ok) lx++;
  const errs = (c.errors || []).slice(0, 3).map(e => e.rule).join(',');
  console.log(p(short, 30) + p(a.ok ? 'ok' : 'FAIL', 8) + p(b.ok ? 'ok' : 'FAIL', 8) + p(c.ok ? 'ok' : (c.errors.length + ' err'), 8) + errs);
  if (!b.ok) console.log('    xsd:', (b.errors[0] || '').slice(0, 130));
}
console.log(`\n${n} files | parse ${px}/${n} | xsd ${xx}/${n} | lint-clean ${lx}/${n}`);
