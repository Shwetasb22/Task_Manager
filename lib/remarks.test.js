const test = require('node:test');
const assert = require('node:assert/strict');
const { ownerNames, remarkRecipients, buildRemark, remarkThread } = require('./remarks');

const task = { id: 'SI-7', manager: 'Sagar Ingle', owner: 'Riya Patel / Amit Rao' };

test('ownerNames splits a multi-owner cell and drops Unassigned', () => {
  assert.deepEqual(ownerNames('Riya Patel / Amit Rao, Riya Patel'), ['Riya Patel', 'Amit Rao']);
  assert.deepEqual(ownerNames('Unassigned'), []);
});

test('managers write to the owners, the assigned owner writes to the manager, others cannot', () => {
  assert.deepEqual(remarkRecipients(task, { role: 'Manager', name: 'Sagar Ingle' }), { side: 'owner', names: ['Riya Patel', 'Amit Rao'] });
  assert.deepEqual(remarkRecipients(task, { role: 'Owner', name: 'Amit Rao' }), { side: 'manager', names: ['Sagar Ingle'] });
  assert.deepEqual(remarkRecipients(task, { role: 'Owner', name: 'Someone Else' }), { side: null, names: [] });
});

test('buildRemark mentions the recipients and marks a reopen', () => {
  const r = buildRemark(task, { role: 'Manager', name: 'Sagar Ingle' }, '  Upload the signed PPAP  ', { reopened: true });
  assert.equal(r.text, '@Riya Patel @Amit Rao Reopened — proof not accepted. Upload the signed PPAP');
  assert.deepEqual(r.mentions, ['Riya Patel', 'Amit Rao']);
  const back = buildRemark(task, { role: 'Owner', name: 'Riya Patel' }, 'Uploaded again');
  assert.equal(back.text, '@Sagar Ingle Uploaded again');
  assert.throws(() => buildRemark(task, { role: 'Manager', name: 'x' }, '   '), /Write a remark/);
  assert.throws(() => buildRemark({ ...task, owner: 'Unassigned' }, { role: 'Manager', name: 'x' }, 'hi'), /no owner/);
});

test('remarkThread keeps only comments, oldest first', () => {
  const thread = remarkThread([
    { id: 2, action: 'comment', actor_name: 'B', at: '2026-01-02', detail: { text: 'second' } },
    { id: 3, action: 'update', at: '2026-01-03', detail: {} },
    { id: 1, action: 'comment', actor_name: 'A', at: '2026-01-01', detail: { text: 'first' } },
  ]);
  assert.deepEqual(thread.map((m) => m.text), ['first', 'second']);
});

test('remarkThread keeps write order for remarks with the same timestamp (history is newest-first)', () => {
  const at = '2026-01-01T10:00:00.000Z';
  const thread = remarkThread([
    { id: 'b', action: 'comment', at, detail: { text: 'reply' } },
    { id: 'a', action: 'comment', at, detail: { text: 'question' } },
  ]);
  assert.deepEqual(thread.map((m) => m.text), ['question', 'reply']);
});
