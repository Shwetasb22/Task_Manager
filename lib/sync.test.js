const test = require('node:test');
const assert = require('node:assert/strict');
const { planSync, applySync, chunk } = require('./sync');

const cached = [
  { id: 'A', updated_at: 't1', remark: 'old' },
  { id: 'B', updated_at: 't1' },
  { id: 'C', updated_at: 't1' },
];

test('only new and changed issues are downloaded; deleted ones are dropped', () => {
  const plan = planSync(cached, [{ id: 'A', updated_at: 't2' }, { id: 'B', updated_at: 't1' }, { id: 'D', updated_at: 't1' }]);
  assert.deepEqual(plan.keep.map((r) => r.id), ['B']);
  assert.deepEqual(plan.fetchIds, ['A', 'D']);
  assert.equal(plan.removed, 1);
  const rows = applySync(plan.keep, [{ id: 'A', updated_at: 't2', remark: 'new' }, { id: 'D', updated_at: 't1' }]);
  assert.deepEqual(rows.map((r) => `${r.id}:${r.remark || ''}`).sort(), ['A:new', 'B:', 'D:']);
});

test('nothing changed means nothing to download', () => {
  const plan = planSync(cached, cached.map(({ id, updated_at }) => ({ id, updated_at })));
  assert.equal(plan.fetchIds.length, 0);
  assert.equal(plan.keep.length, 3);
  assert.equal(plan.removed, 0);
});

test('an empty cache downloads everything', () => {
  assert.deepEqual(planSync(null, [{ id: 'X', updated_at: 't' }]).fetchIds, ['X']);
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});
