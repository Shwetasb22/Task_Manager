const test = require('node:test');
const assert = require('node:assert/strict');
const { rollbackTaskPatch } = require('./task-patches');

test('rollback restores only failed fields on the affected task', () => {
  const current = [
    { id: 'A', due: '2026-10-12', remark: 'newer remark', owner: 'Current owner' },
    { id: 'B', due: '2026-10-15', remark: 'unrelated task' },
  ];

  const result = rollbackTaskPatch(current, 'A', { due: '2026-10-10' });

  assert.deepEqual(result, [
    { id: 'A', due: '2026-10-10', remark: 'newer remark', owner: 'Current owner' },
    { id: 'B', due: '2026-10-15', remark: 'unrelated task' },
  ]);
});