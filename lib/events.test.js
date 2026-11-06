const test = require('node:test');
const assert = require('node:assert/strict');
const { describeEvent, buildNotifications } = require('./events');

const tasks = [
  { id: 'YD-1', program: 'P1', owner: 'Anjali', status: 'Closed' },
  { id: 'YD-2', program: 'P2', owner: 'Anjali', status: 'Open' },
];
const manager = { id: 'm-1', role: 'Manager', name: 'Yogesh Dhamale', display: 'Yogesh Dhamale' };
const owner = { id: 'o-1', role: 'Owner', name: 'Anjali', display: 'Anjali' };

test('describeEvent explains closes, reopens and field changes in plain words', () => {
  assert.deepEqual(describeEvent({ actor_name: 'Anjali', action: 'update', detail: { closed_date: { from: null, to: '2026-10-12' } } }),
    ['Anjali closed the issue (2026-10-12)']);
  assert.deepEqual(describeEvent({ actor_name: 'Yogesh', action: 'update', detail: { closed_date: { from: '2026-10-12', to: null }, member: { from: 'a', to: 'b' } } }),
    ['Yogesh reopened the issue and sent it back to the owner']);
  assert.deepEqual(describeEvent({ actor_name: 'Yogesh', action: 'update', detail: { due_date: { from: null, to: '2026-10-20' } } }),
    ['Yogesh changed Target date from — to 2026-10-20']);
  assert.deepEqual(describeEvent({ actor_name: 'Yogesh', action: 'created', detail: { owner: 'Anjali' } }), ['Yogesh added the issue for Anjali']);
});

test('managers are told about owner remarks, closures still closed, and proof uploads', () => {
  const events = [
    { id: 1, task_id: 'YD-1', actor: 'o-1', actor_name: 'Anjali', action: 'update', detail: { closed_date: { from: null, to: '2026-10-12' } }, at: '2026-10-12T05:00:00Z' },
    { id: 2, task_id: 'YD-2', actor: 'o-1', actor_name: 'Anjali', action: 'proof_added', detail: { filename: 'a.pdf' }, at: '2026-10-12T06:00:00Z' },
    { id: 3, task_id: 'YD-2', actor: 'm-1', actor_name: 'Yogesh Dhamale', action: 'proof_added', detail: {}, at: '2026-10-12T07:00:00Z' },
    { id: 4, task_id: 'YD-2', actor: 'o-1', actor_name: 'Anjali', action: 'update', detail: { remark: { from: '', to: 'Please review the revised proof' } }, at: '2026-10-12T08:00:00Z' },
  ];
  assert.deepEqual(buildNotifications(events, tasks, manager).map((n) => n.kind), ['remark', 'proof', 'review']);
});

test('owners are told about send-backs, remarks and new assignments, not their own actions', () => {
  const events = [
    { id: 1, task_id: 'YD-2', actor: 'm-1', actor_name: 'Yogesh', action: 'update', detail: { closed_date: { from: '2026-10-11', to: null } }, at: '2026-10-12T05:00:00Z' },
    { id: 2, task_id: 'YD-2', actor: 'm-1', actor_name: 'Yogesh', action: 'update', detail: { remark: { from: '', to: 'Add photos' } }, at: '2026-10-12T06:00:00Z' },
    { id: 3, task_id: 'YD-1', actor: 'm-1', actor_name: 'Yogesh', action: 'created', detail: { owner: 'Anjali' }, at: '2026-10-12T07:00:00Z' },
    { id: 4, task_id: 'YD-2', actor: 'o-1', actor_name: 'Anjali', action: 'update', detail: { remark: { from: '', to: 'done' } }, at: '2026-10-12T08:00:00Z' },
    { id: 5, task_id: 'XX-9', actor: 'm-1', actor_name: 'Yogesh', action: 'created', detail: { owner: 'Anjali' }, at: '2026-10-12T09:00:00Z' },
  ];
  assert.deepEqual(buildNotifications(events, tasks, owner).map((n) => n.kind), ['assigned', 'remark', 'sent-back']);
});

test('comments notify the people they mention, and owners and managers of the issue', () => {
  const admin = { id: 'a-1', role: 'Admin', name: 'Naveen Sahni', display: 'Naveen Sahni' };
  const events = [
    { id: 1, task_id: 'YD-2', actor: 'm-1', actor_name: 'Yogesh Dhamale', action: 'comment', detail: { text: '@Naveen Sahni please approve', mentions: ['Naveen Sahni'] }, at: '2026-10-12T05:00:00Z' },
    { id: 2, task_id: 'YD-2', actor: 'm-1', actor_name: 'Yogesh Dhamale', action: 'comment', detail: { text: 'Need photos, @anjali', mentions: ['anjali'] }, at: '2026-10-12T06:00:00Z' },
    { id: 3, task_id: 'YD-1', actor: 'o-1', actor_name: 'Anjali', action: 'comment', detail: { text: 'Supplier is late', mentions: [] }, at: '2026-10-12T07:00:00Z' },
  ];
  assert.deepEqual(buildNotifications(events, tasks, admin).map((n) => `${n.kind}:${n.id}`), ['mention:1']);
  assert.deepEqual(buildNotifications(events, tasks, owner).map((n) => `${n.kind}:${n.id}`), ['mention:2', 'comment:1']);
  assert.deepEqual(buildNotifications(events, tasks, manager).map((n) => `${n.kind}:${n.id}`), ['comment:3']);
  assert.deepEqual(describeEvent(events[2]), ['Anjali commented: "Supplier is late"']);
});
