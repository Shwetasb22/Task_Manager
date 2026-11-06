const test = require('node:test');
const assert = require('node:assert/strict');
const { applyLiveChange } = require('./live');

const base = [
  { id: 'A-2', program: 'P2', remark: '', proofs: [{ id: 'p1', name: 'a.pdf' }] },
  { id: 'A-1', program: 'P1', remark: '', proofs: [] },
];

test('an edited issue is merged in place and keeps its proofs', () => {
  const out = applyLiveChange(base, { type: 'upsert', task: { id: 'A-2', program: 'P2', remark: 'new' } });
  assert.equal(out[0].remark, 'new');
  assert.deepEqual(out[0].proofs, base[0].proofs);
  assert.equal(out[1], base[1], 'untouched rows keep their identity');
});

test('a new issue is added at the top', () => {
  const out = applyLiveChange(base, { type: 'upsert', task: { id: 'A-3', program: 'P3' } });
  assert.deepEqual(out.map((t) => t.id), ['A-3', 'A-2', 'A-1']);
  assert.deepEqual(out[0].proofs, []);
});

test('deletes and proof changes', () => {
  assert.deepEqual(applyLiveChange(base, { type: 'delete', id: 'A-1' }).map((t) => t.id), ['A-2']);
  assert.equal(applyLiveChange(base, { type: 'delete', id: 'nope' }), base);
  const added = applyLiveChange(base, { type: 'proof-added', taskId: 'A-1', proof: { id: 'p2' } });
  assert.equal(added[1].proofs.length, 1);
  assert.equal(applyLiveChange(added, { type: 'proof-added', taskId: 'A-1', proof: { id: 'p2' } })[1].proofs.length, 1, 'no duplicates');
  assert.equal(applyLiveChange(base, { type: 'proof-removed', proofId: 'p1' })[0].proofs.length, 0);
});

test('unknown changes leave the list alone', () => {
  assert.equal(applyLiveChange(base, { type: 'other' }), base);
  assert.equal(applyLiveChange(base, null), base);
});
