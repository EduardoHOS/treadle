// Measures the two diffs that decide whether the moddle-as-source-of-truth
// architecture can keep its promise ("we only rewrite what you asked us to change"):
//
//   1. NORMALIZE  original bytes -> moddle re-serialized bytes.  A one-time cost,
//      paid on first edit, exactly like running Prettier on a file for the first time.
//   2. EDIT       normalized bytes -> normalized bytes after ONE semantic change.
//      This is the number that matters. If it is ~1 line, the architecture works.
//
// Also reports how many dc:Bounds moved, which is the gate that catches a relayout
// disaster and no other gate does.
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

// Minimal line diff (Myers is overkill here; we only need changed-line counts).
function diffLines(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  // LCS on lines, capped so a 240 KB file does not blow up.
  const n = A.length, m = B.length;
  if (n * m > 4_000_000) {
    const setB = new Map();
    for (const l of B) setB.set(l, (setB.get(l) || 0) + 1);
    let common = 0;
    for (const l of A) { const c = setB.get(l); if (c > 0) { common++; setB.set(l, c - 1); } }
    return { removed: n - common, added: m - common, approx: true };
  }
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const lcs = dp[0][0];
  return { removed: n - lcs, added: m - lcs, approx: false };
}

function boundsSet(xml) {
  const out = [];
  const re = /<dc:Bounds[^>]*x="([-\d.]+)"[^>]*y="([-\d.]+)"/g;
  let m;
  while ((m = re.exec(xml))) out.push(`${m[1]},${m[2]}`);
  return out;
}

// Find the first flow node with a name and change it. This is the smallest
// possible real edit: one attribute, no structural change, no new DI.
function firstNamedNode(root) {
  const seen = new Set(), stack = [root];
  while (stack.length) {
    const el = stack.shift();
    if (!el || typeof el !== 'object' || seen.has(el)) continue;
    seen.add(el);
    if (el.$type && /^bpmn:(User|Service|Manual|Send|Receive|Script|BusinessRule)?Task$/.test(el.$type) && el.name) return el;
    for (const k of Object.keys(el)) {
      if (k === '$parent' || k === '$model' || k === '$descriptor') continue;
      const v = el[k];
      if (Array.isArray(v)) stack.push(...v);
      else if (v && typeof v === 'object') stack.push(v);
    }
  }
  return null;
}

const p = (s, n) => String(s ?? '').padEnd(n);
const W = [30, 7, 22, 22, 8];
console.log(['file', 'lines', 'normalize (one-time)', 'one-attr edit', 'moved'].map((h, i) => p(h, W[i])).join(''));
console.log('-'.repeat(W.reduce((a, b) => a + b, 0)));

let editTotals = [];
for (const file of walk(process.argv[2] || 'bench/corpus')) {
  const short = file.split(sep).join('/').replace('bench/corpus/', '');
  const xml = readFileSync(file, 'utf8');
  const moddle = new BpmnModdle();
  const { rootElement } = await moddle.fromXML(xml);
  const { xml: normalized } = await moddle.toXML(rootElement, { format: true });

  const node = firstNamedNode(rootElement);
  if (!node) { console.log(p(short, 30), p(xml.split('\n').length, 7), 'no named task — skipped'); continue; }
  const before = node.name;
  node.name = before + ' (revised)';
  const { xml: edited } = await moddle.toXML(rootElement, { format: true });

  const dn = diffLines(xml, normalized);
  const de = diffLines(normalized, edited);
  const b1 = boundsSet(normalized), b2 = boundsSet(edited);
  const moved = b1.filter((v, i) => v !== b2[i]).length;
  editTotals.push(de.removed + de.added);

  console.log([
    short,
    xml.split('\n').length,
    `-${dn.removed} +${dn.added}${dn.approx ? ' ~' : ''}`,
    `-${de.removed} +${de.added}${de.approx ? ' ~' : ''}`,
    `${moved}/${b1.length}`,
  ].map((v, i) => p(v, W[i])).join(''));
}

const worst = Math.max(...editTotals);
const med = editTotals.sort((a, b) => a - b)[Math.floor(editTotals.length / 2)];
console.log(`\nOne-attribute edit on an already-normalized file: median ${med} changed lines, worst ${worst}.`);
console.log('If that number is small and "moved" is 0, moddle-as-source-of-truth keeps its promise.');
