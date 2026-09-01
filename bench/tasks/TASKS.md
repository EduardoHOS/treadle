# The 20 edit tasks

**You write the prompts. I write the assertions.** That split is deliberate: assertions
are mechanical, but if I write the prompts too I will unconsciously write tasks my own
patch API happens to handle well, and the bake-off measures nothing.

Write each prompt the way you would actually say it to an agent that has the file open.
Plain English. Don't name element ids, don't say "add a `bpmn:UserTask`" — say
"add a step where someone checks the documents". If the phrasing is slightly ambiguous,
that is realistic and fine; I'll write the assertion against the reasonable reading.

Element names and ids to write against are in
[CORPUS-INVENTORY.md](CORPUS-INVENTORY.md).

## Coverage to aim for

Spread the 20 across these, roughly evenly. The categories on the right are where each
arm is expected to break, which is the point.

| category | why it's in the set |
|---|---|
| insert a step in a sequence | the base case; splice sugar vs. three manual rewires |
| delete a step and heal the chain | naive editing leaves dangling flows |
| add a boundary event (timer or error) | attachment is a separate ref that text editing gets wrong |
| split a path on a condition | needs a new gateway plus two conditional flows |
| add a parallel branch and rejoin | the hardest structural edit |
| move a task to another lane | lane membership lives on the lane, not the node |
| rename something referenced downstream | a flow id appears three times in the XML |
| edit inside a subprocess | scoping — the edit must land in the right container |
| change a condition expression | small, but has to land on the right flow |
| add a message flow between pools | cross-pool: only message flows may cross |

## File selection

Pick deliberately across strata — the naive arm is expected to fail outright above
~15,000 tokens, and we need enough large-file tasks to see it.

- **small** (<15 nodes): `A.1.0`, `A.2.0`, `A.3.0`, `C.9.1`, `C.1.1`, `C.7.0`, `C.3.0`
- **medium** (15–50): `C.9.0`, `C.9.2`, `A.4.0`, `A.4.1`, `C.1.0`, `B.1.0`, `C.2.0`, `C.5.0`, `C.4.0`, `C.6.0`
- **large / over the tool-response cap**: `B.2.0` (94 nodes, ~35k tokens), `C.8.0` (~60k), `C.8.1` (~33k)

At least 6 tasks should target files above 15,000 tokens.

---

## The tasks

Two worked examples so the format is clear. Replace and extend to 20.

| # | file | prompt |
|---|---|---|
| T01 | `miwg/C.9.0.bpmn` | After the credit score is fetched, add a step where an analyst reviews the score before the decision is made. |
| T02 | `miwg/C.9.0.bpmn` | The manual check should time out after 3 days and go to the timeout handler. |
| T03 | | |
| T04 | | |
| T05 | | |
| T06 | | |
| T07 | | |
| T08 | | |
| T09 | | |
| T10 | | |
| T11 | | |
| T12 | | |
| T13 | | |
| T14 | | |
| T15 | | |
| T16 | | |
| T17 | | |
| T18 | | |
| T19 | | |
| T20 | | |

---

## What happens next

I turn each row into an entry in `bench/tasks/tasks.mjs`:

```js
{
  id: 'T01',
  file: 'miwg/C.9.0.bpmn',
  prompt: 'After the credit score is fetched, add a step where an analyst reviews …',
  // Machine-checkable. Runs against the projected IR of whatever the arm produced.
  check(ir) {
    const added = ir.nodes.filter(n => !BASELINE_IDS.has(n.id));
    assert(added.length === 1, 'exactly one node added');
    assert(/review|analyst/i.test(added[0].name), 'named for what it does');
    assert(isBetween(ir, 'ServiceTask_GetCreditScore', added[0].id, 'ExclusiveGateway_Decision'),
           'sits between the credit score task and the decision gateway');
  },
}
```

Then all three arms run the same 20 tasks and are scored by the same five gates in
`bench/scorer/gates.mjs`. Decision rules were committed in advance and are in
[../../docs/DECISIONS.md](../../docs/DECISIONS.md).
