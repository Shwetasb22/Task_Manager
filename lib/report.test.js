const test = require('node:test');
const assert = require('node:assert/strict');
const { weeklyReport, snapshot } = require('./report');

const end = new Date(2026, 9, 14); // Wed 14-Oct-2026; week = 08..14 Oct
const raw = [
  { id: 'R-1', manager: 'A', dept: 'PE', start: '2026-09-01', due: '2026-10-01', closed: null },              // overdue 13 days (L3), was overdue 6 days last week
  { id: 'R-2', manager: 'A', dept: 'PE', start: '2026-09-01', due: '2026-10-12', closed: '2026-10-10' },      // closed this week, on time
  { id: 'R-3', manager: 'B', dept: 'QA', start: '2026-09-01', due: '2026-10-05', closed: '2026-10-09' },      // closed this week, late; overdue last week
  { id: 'R-4', manager: 'B', dept: 'QA', start: '2026-10-09', due: '2026-10-18', closed: null },              // added this week, due next week
  { id: 'R-5', manager: 'B', dept: 'QA', start: '2026-09-01', due: null, closed: null },                      // no date
  { id: 'R-6', manager: 'A', dept: 'PE', start: '2026-09-01', due: '2026-09-20', closed: '2026-09-25' },      // closed long ago
];

test('a snapshot undoes later closures and hides issues that did not exist yet', () => {
  const lastWeek = snapshot(raw, new Date(2026, 9, 7));
  assert.deepEqual(lastWeek.map((t) => `${t.id}:${t.status}`), ['R-1:Overdue', 'R-2:Open', 'R-3:Overdue', 'R-5:Open', 'R-6:Closed']);
});

test('the weekly report counts the week and compares with the week before', () => {
  const r = weeklyReport(raw, end);
  assert.equal(r.from, '2026-10-08');
  assert.equal(r.to, '2026-10-14');
  assert.deepEqual(r.now, { open: 3, overdue: 1, l3: 1, gap: 1, closed: 2, added: 1, onTime: 1 });
  assert.deepEqual(r.prev, { open: 4, overdue: 2, l3: 0, gap: 1 });
  assert.deepEqual(r.closed.map((t) => `${t.id}:${t.onTime}`), ['R-2:true', 'R-3:false']);
  assert.deepEqual(r.added.map((t) => t.id), ['R-4']);
  assert.deepEqual(r.dueNextWeek.map((t) => t.id), ['R-4']);
  assert.deepEqual(r.overdue.map((t) => t.id), ['R-1']);
});

test('groups show open work and the week\'s closures per tracker and department', () => {
  const r = weeklyReport(raw, end);
  assert.deepEqual(r.byTracker, [
    { name: 'A', open: 1, overdue: 1, l3: 1, closed: 1, onTime: 1 },
    { name: 'B', open: 2, overdue: 0, l3: 0, closed: 1, onTime: 0 },
  ]);
  assert.deepEqual(r.byDept.map((g) => g.name), ['PE', 'QA']);
});
