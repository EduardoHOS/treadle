// Incremental DI placement: give new elements a shape or edge without touching
// anything that already has one.
//
// This exists because full-file auto-layout fails on 41% of the OMG's own reference
// models (docs/FINDINGS.md F4). We never re-run it on a file that already has DI.
// Instead: a new node goes where a human would put it — next to its neighbours —
// and only shapes downstream of the insertion move, by exactly one column.
import { index } from './ir.mjs';

const SIZE = {
  'bpmn:StartEvent': [36, 36], 'bpmn:EndEvent': [36, 36],
  'bpmn:IntermediateCatchEvent': [36, 36], 'bpmn:IntermediateThrowEvent': [36, 36],
  'bpmn:BoundaryEvent': [36, 36],
  'bpmn:ExclusiveGateway': [50, 50], 'bpmn:ParallelGateway': [50, 50],
  'bpmn:InclusiveGateway': [50, 50], 'bpmn:EventBasedGateway': [50, 50],
  'bpmn:ComplexGateway': [50, 50],
  'bpmn:SubProcess': [350, 200], 'bpmn:Transaction': [350, 200],
};
const DEFAULT_SIZE = [100, 80];
const GAP = 50;

function sizeOf(el) {
  return SIZE[el.$type] ?? DEFAULT_SIZE;
}

function* walk(el, seen = new Set()) {
  if (!el || typeof el !== 'object' || seen.has(el)) return;
  seen.add(el);
  yield el;
  for (const k of Object.keys(el)) {
    if (k === '$parent' || k === '$model' || k === '$descriptor') continue;
    const v = el[k];
    if (Array.isArray(v)) for (const c of v) yield* walk(c, seen);
    else if (v && typeof v === 'object') yield* walk(v, seen);
  }
}

// Every BPMNPlane in the document, and the DI entries on it, keyed by element id.
function diIndex(definitions) {
  const planes = [];
  const byElement = new Map();
  for (const el of walk(definitions)) {
    if (el.$type === 'bpmndi:BPMNPlane') planes.push(el);
    if ((el.$type === 'bpmndi:BPMNShape' || el.$type === 'bpmndi:BPMNEdge') && el.bpmnElement?.id) {
      byElement.set(el.bpmnElement.id, el);
    }
  }
  return { planes, byElement };
}

function planeFor(planes, byElement, el) {
  // Put a new shape on the plane that already holds its siblings.
  let p = el.$parent;
  while (p) {
    const di = byElement.get(p.id);
    if (di?.$parent?.$type === 'bpmndi:BPMNPlane') return di.$parent;
    for (const plane of planes) if (plane.bpmnElement?.id === p.id) return plane;
    p = p.$parent;
  }
  return planes[0] ?? null;
}

function bounds(di) {
  return di?.bounds ? { x: di.bounds.x, y: di.bounds.y, w: di.bounds.width, h: di.bounds.height } : null;
}

/**
 * Places DI for every element in `ids` that has none.
 * Returns { placed, movedShapes } so the caller can report honestly how much moved.
 */
export function placeNew({ moddle, definitions }, ids) {
  const byId = index(definitions);
  const { planes, byElement } = diIndex(definitions);
  if (!planes.length) return { placed: [], movedShapes: 0, reason: 'no BPMNPlane — file has no DI at all' };

  const placed = [];
  let movedShapes = 0;

  // --- nodes first, so edges can dock to real geometry ---------------------
  for (const id of ids) {
    const el = byId.get(id);
    if (!el || byElement.has(id)) continue;
    if (el.$type === 'bpmn:SequenceFlow' || el.$type === 'bpmn:MessageFlow') continue;

    const [w, h] = sizeOf(el);
    let x, y;

    if (el.attachedToRef) {
      // Boundary event: dock on the host's bottom edge, offset right of centre.
      const host = bounds(byElement.get(el.attachedToRef.id));
      if (!host) continue;
      x = host.x + host.w - 20 - w / 2;
      y = host.y + host.h - h / 2;
    } else {
      // Flow node: sit between its predecessor and successor.
      const incoming = (el.incoming || []).map((f) => bounds(byElement.get(f.sourceRef?.id))).filter(Boolean);
      const outgoing = (el.outgoing || []).map((f) => bounds(byElement.get(f.targetRef?.id))).filter(Boolean);
      const prev = incoming[0], next = outgoing[0];
      if (prev && next) {
        const gapStart = prev.x + prev.w;
        const gapWidth = next.x - gapStart;
        if (gapWidth >= w + 2 * GAP) {
          x = gapStart + (gapWidth - w) / 2;              // it fits: nothing moves
        } else {
          x = gapStart + GAP;                              // make room: shift downstream
          const shift = w + 2 * GAP - gapWidth;
          for (const [otherId, di] of byElement) {
            if (otherId === id || di.$type !== 'bpmndi:BPMNShape' || !di.bounds) continue;
            if (di.bounds.x >= next.x) { di.bounds.x += shift; movedShapes++; }
          }
          for (const [, di] of byElement) {
            if (di.$type !== 'bpmndi:BPMNEdge' || !di.waypoint) continue;
            for (const wp of di.waypoint) if (wp.x >= next.x) wp.x += shift;
          }
        }
        y = prev.y + prev.h / 2 - h / 2;
      } else if (prev) {
        x = prev.x + prev.w + GAP;
        y = prev.y + prev.h / 2 - h / 2;
      } else if (next) {
        x = next.x - w - GAP;
        y = next.y + next.h / 2 - h / 2;
      } else {
        // Nothing to anchor to: park below the existing content.
        let maxY = 0, minX = Infinity;
        for (const [, di] of byElement) if (di.bounds) { maxY = Math.max(maxY, di.bounds.y + di.bounds.height); minX = Math.min(minX, di.bounds.x); }
        x = Number.isFinite(minX) ? minX : 150;
        y = maxY + 80;
      }
    }

    const plane = planeFor(planes, byElement, el);
    if (!plane) continue;
    const shape = moddle.create('bpmndi:BPMNShape', {
      id: `${id}_di`,
      bpmnElement: el,
      bounds: moddle.create('dc:Bounds', { x: Math.round(x), y: Math.round(y), width: w, height: h }),
    });
    if (/SubProcess|Transaction/.test(el.$type) && el.flowElements?.length) shape.isExpanded = true;
    shape.$parent = plane;
    plane.planeElement.push(shape);
    byElement.set(id, shape);
    placed.push(id);
  }

  // --- then edges ----------------------------------------------------------
  for (const id of ids) {
    const el = byId.get(id);
    if (!el || byElement.has(id)) continue;
    if (el.$type !== 'bpmn:SequenceFlow' && el.$type !== 'bpmn:MessageFlow') continue;
    const a = bounds(byElement.get(el.sourceRef?.id));
    const b = bounds(byElement.get(el.targetRef?.id));
    if (!a || !b) continue;

    const from = { x: a.x + a.w, y: a.y + a.h / 2 };
    const to = { x: b.x, y: b.y + b.h / 2 };
    const points = from.y === to.y
      ? [from, to]
      : [from, { x: from.x + (to.x - from.x) / 2, y: from.y }, { x: from.x + (to.x - from.x) / 2, y: to.y }, to];

    const plane = planeFor(planes, byElement, el);
    if (!plane) continue;
    const edge = moddle.create('bpmndi:BPMNEdge', {
      id: `${id}_di`,
      bpmnElement: el,
      waypoint: points.map((p) => moddle.create('dc:Point', { x: Math.round(p.x), y: Math.round(p.y) })),
    });
    edge.$parent = plane;
    plane.planeElement.push(edge);
    byElement.set(id, edge);
    placed.push(id);
  }

  return { placed, movedShapes };
}

/**
 * The gate from ADR-005: every element that needs DI must have it.
 * Run after any operation that touches the model. The layouter's own warnings
 * channel is not trusted — C.4.0 lost 52 elements and reported none.
 */
const NEEDS_SHAPE = /^bpmn:(Start|End|Boundary|IntermediateCatch|IntermediateThrow)Event$|^bpmn:(User|Service|Script|Manual|Send|Receive|BusinessRule)?Task$|^bpmn:(Sub|AdHocSub)Process$|^bpmn:Transaction$|^bpmn:CallActivity$|^bpmn:(Exclusive|Parallel|Inclusive|EventBased|Complex)Gateway$|^bpmn:Participant$|^bpmn:Lane$/;
const NEEDS_EDGE = /^bpmn:(SequenceFlow|MessageFlow)$/;

export function diCoverage(definitions) {
  const { byElement } = diIndex(definitions);
  const missing = [];
  let need = 0;
  for (const el of walk(definitions)) {
    if (!el.id || !el.$type) continue;
    if (!NEEDS_SHAPE.test(el.$type) && !NEEDS_EDGE.test(el.$type)) continue;
    need++;
    if (!byElement.has(el.id)) missing.push({ id: el.id, type: el.$type });
  }
  return { ok: missing.length === 0, need, covered: need - missing.length, missing };
}
