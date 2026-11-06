const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveTask } = require('./rules');
const { filterTasks, countQuickViews, cleanView, describeView } = require('./views');

const today = new Date(2026, 9, 14);
const raw = [
  { id: 'A-1', owner: 'Anjali Iyer', program: 'KTM', due: '2026-10-01', closed: null, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'A-2', owner: 'Rohan / Anjali', program: 'Pulsar', due: '2026-10-18', closed: null, createdAt: '2026-10-10T00:00:00Z' },
  { id: 'A-3', owner: 'Rohan', program: 'KTM', due: null, closed: null, createdAt: '2026-01-01T00:00:00Z' },
  { id: 'A-4', owner: 'Anjali Iyer', program: 'KTM', due: '2026-09-01', closed: '2026-10-05', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'A-5', owner: 'Meera', program: 'KTM', due: '2026-10-12', closed: null, createdAt: '2026-01-01T00:00:00Z' },
];
const tasks = raw.map((t) => deriveTask(t, today));
const owner = { role: 'Owner', name: 'Anjali Iyer', aliases: ['anjali iyer', 'anjali'] };
const ids = (view, session = owner) => filterTasks(tasks, view, { today, session }).map((t) => t.id);

test('quick views pick the right issues', () => {
  assert.deepEqual(ids({ quick: 'mine' }), ['A-1', 'A-2']);
  assert.deepEqual(ids({ quick: 'overdue' }), ['A-1', 'A-5']);
  assert.deepEqual(ids({ quick: 'week' }), ['A-2']);
  assert.deepEqual(ids({ quick: 'l3' }), ['A-1']);
  assert.deepEqual(ids({ quick: 'gap' }), ['A-3']);
  assert.deepEqual(ids({ quick: 'closed30' }), ['A-4']);
  assert.deepEqual(ids({ quick: 'new7' }), ['A-2']);
});

test('quick view, status and search combine', () => {
  assert.deepEqual(ids({ quick: 'overdue', q: 'ktm' }), ['A-1', 'A-5']);
  assert.deepEqual(ids({ quick: 'all', status: 'No Target Date', q: 'ktm' }), ['A-3']);
  assert.deepEqual(ids({ quick: 'all', status: 'Data Gap', q: 'ktm' }), ['A-3'], 'older saved views still work');
  assert.deepEqual(ids({ quick: 'all', status: 'Due Soon' }), []);
  assert.deepEqual(ids({ quick: 'all', status: 'On Track' }), ['A-2']);
  assert.deepEqual(ids({ quick: 'mine', status: 'Overdue' }), ['A-1']);
});

test('a manager\'s "mine" means issues naming them as owner', () => {
  assert.deepEqual(ids({ quick: 'mine' }, { role: 'Manager', name: 'Meera' }), ['A-5']);
});

test('counts match the filters', () => {
  const counts = countQuickViews(tasks, { today, session: owner });
  assert.equal(counts.all, 5);
  assert.equal(counts.overdue, 2);
  assert.equal(counts.mine, 2);
});

test('saved views are cleaned and described', () => {
  assert.deepEqual(cleanView({ q: 'KTM', status: 'Bogus', quick: 'nope', extra: 1 }), { q: 'KTM', status: 'Active', quick: 'all' });
  assert.equal(describeView({ q: 'KTM', status: 'Open', quick: 'week' }), 'Due in 7 days · Open · "KTM"');
  assert.equal(describeView({}), 'Active issues');
  assert.equal(describeView({ status: 'All' }), 'All issues');
});
