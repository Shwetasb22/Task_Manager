const test = require('node:test');
const assert = require('node:assert/strict');
const aggregations = import('./aggregations.js');

const strip = (rows) => rows.map(({ members, ...rest }) => rest);

test('groupByDepartment normalizes names and counts all five RYGB colours', async () => {
  const { groupByDepartment } = await aggregations;
  const rows = groupByDepartment([
    { dept: ' pe ', status: 'Overdue', rgy: 'Red' },
    { dept: 'PE', status: 'Open', rgy: 'Yellow' },
    { dept: null, status: 'Overdue', rgy: 'Red' },
    { dept: 'pe', status: 'Closed', rgy: 'Blue' },
    { dept: 'PE', status: 'Open', rgy: 'Grey' },
    { dept: 'PE', status: 'Open', rgy: 'Green' },
  ]);
  assert.deepEqual(strip(rows), [
    { department: 'PE', red: 1, yellow: 1, green: 1, blue: 1, grey: 1, total: 5 },
    { department: 'Unassigned', red: 1, yellow: 0, green: 0, blue: 0, grey: 0, total: 1 },
  ]);
});

test('groupByDepartment puts the worst first and folds the rest into Others (with its members)', async () => {
  const { groupByDepartment } = await aggregations;
  const tasks = Array.from({ length: 12 }, (_, index) => ({
    dept: `D${index}`, status: index === 0 ? 'Overdue' : 'Open', rgy: index === 0 ? 'Red' : 'Green',
  }));
  const rows = groupByDepartment(tasks);
  assert.equal(rows.length, 11);
  assert.equal(rows[0].department, 'D0');
  assert.equal(rows.at(-1).department, 'Others');
  assert.equal(rows.at(-1).total, 2);
  assert.equal(rows.at(-1).members.length, 2);
  assert.equal(rows.reduce((sum, row) => sum + row.total, 0), tasks.length);
});

test('groupByRgy returns one slice per colour in theme order; top overdue ignores other colours', async () => {
  const { groupByRgy, getTopOverdueIssues } = await aggregations;
  const tasks = [
    { id: 'CLOSED', status: 'Closed', rgy: 'Blue', daysLate: null },
    { id: 'SOON', status: 'Open', rgy: 'Yellow', daysToDue: 1 },
    { id: 'TRACK', status: 'Open', rgy: 'Green', daysToDue: 9 },
    { id: 'GAP', status: 'Open', rgy: 'Grey', daysLate: null },
    ...Array.from({ length: 12 }, (_, index) => ({ id: `I${index}`, status: 'Overdue', rgy: 'Red', daysLate: index + 1 })),
  ];
  assert.deepEqual(groupByRgy(tasks).map(({ name, label, value }) => [name, label, value]), [
    ['Red', 'Overdue', 12], ['Yellow', 'Due Soon', 1], ['Green', 'On Track', 1], ['Blue', 'Closed', 1], ['Grey', 'No Target Date', 1],
  ]);
  const overdue = getTopOverdueIssues(tasks);
  assert.equal(overdue.length, 10);
  assert.equal(overdue[0].id, 'I11');
  assert.ok(overdue.every((task) => task.rgy === 'Red'));
});

test('cross-filter: every selection applies except the visual’s own dimension', async () => {
  const { crossFilter } = await aggregations;
  const tasks = [
    { id: 'A', dept: 'PE', owner: 'Riya', status: 'Overdue', rgy: 'Red', esc: 'L1 Owner', daysToDue: -2, daysLate: 2 },
    { id: 'B', dept: 'PE', owner: 'Amit', status: 'Open', rgy: 'Green', esc: 'Neutral', daysToDue: 9 },
    { id: 'C', dept: 'QE', owner: 'Riya', status: 'Overdue', rgy: 'Red', esc: 'L3 HOD', daysToDue: -9, daysLate: 9 },
    { id: 'D', dept: 'QE', owner: 'Amit', status: 'Closed', rgy: 'Blue', esc: 'None', daysToDue: 1 },
  ];
  const ids = (sel, except) => crossFilter(tasks, sel, except).map((t) => t.id);
  assert.deepEqual(ids({}), ['A', 'B', 'C', 'D']);
  assert.deepEqual(ids({ rygb: ['Red'] }), ['A', 'C']);
  assert.deepEqual(ids({ rygb: ['Red'], dept: ['QE'] }), ['C']);
  assert.deepEqual(ids({ rygb: ['Red'], dept: ['QE'] }, 'dept'), ['A', 'C'], 'the department chart keeps all departments');
  assert.deepEqual(ids({ rygb: ['Red'], dept: ['QE'] }, 'rygb'), ['C', 'D'], 'the status chart keeps all colours');
  assert.deepEqual(ids({ owner: ['Riya', 'Amit'], rygb: ['Blue', 'Green'] }), ['B', 'D']);
  assert.deepEqual(ids({ lateness: ['overdue-critical'] }), ['C']);
  assert.deepEqual(ids({ esc: ['L1 Owner'] }), ['A']);
  assert.deepEqual(ids({ esc: ['None'] }), [], 'closed issues have no escalation');
});

test('toggleSelection: click selects, same click clears, ctrl/shift-click adds and removes', async () => {
  const { toggleSelection } = await aggregations;
  let sel = toggleSelection({}, 'rygb', ['Red']);
  assert.deepEqual(sel, { rygb: ['Red'] });
  sel = toggleSelection(sel, 'rygb', ['Yellow']);
  assert.deepEqual(sel, { rygb: ['Yellow'] }, 'a plain click replaces');
  sel = toggleSelection(sel, 'rygb', ['Red'], true);
  assert.deepEqual(sel, { rygb: ['Yellow', 'Red'] }, 'an additive click adds');
  sel = toggleSelection(sel, 'rygb', ['Yellow'], true);
  assert.deepEqual(sel, { rygb: ['Red'] }, 'an additive click on a selected value removes it');
  sel = toggleSelection({ ...sel, dept: ['PE'] }, 'rygb', ['Red']);
  assert.deepEqual(sel, { dept: ['PE'] }, 'clicking the only selected value clears that dimension, others stay');
});

test('escalation bars and colours follow the RYGB meaning of each level', async () => {
  const { groupByEscalation, ESCALATION_COLORS } = await aggregations;
  const rows = groupByEscalation([
    { status: 'Overdue', esc: 'L1 Owner' }, { status: 'Open', esc: 'L2 Manager' }, { status: 'Overdue', esc: 'L3 HOD' },
    { status: 'Open', esc: 'Neutral', rgy: 'Green' }, { status: 'Open', esc: 'Neutral', rgy: 'Grey' }, { status: 'Open', esc: 'Neutral', rgy: 'Grey' },
    { status: 'Closed', esc: 'None' },
  ]);
  assert.deepEqual(rows.map((r) => [r.level, r.issues, r.color]), [
    ['L3 HOD', 1, '#8E0B20'], ['L1 Owner', 1, '#C8102E'], ['L2 Manager', 1, '#E0A800'], ['Neutral', 1, '#2E9E5B'], ['No target date', 2, '#8B8588'],
  ], 'healthy work is green and undated work is grey, never mixed in one bar');
  assert.equal(ESCALATION_COLORS['L1 Owner'], '#C8102E');
  assert.equal(ESCALATION_COLORS['L2 Manager'], '#E0A800');
  assert.equal(ESCALATION_COLORS.Neutral, '#2E9E5B');
});

test('due-date action queue classifies escalation windows and excludes closed tasks', async () => {
  const { groupByDueDateAction } = await aggregations;
  const rows = groupByDueDateAction([
    { id: 'CLOSED', status: 'Closed', daysToDue: -5, daysLate: null },
    { id: 'HOD', status: 'Overdue', daysToDue: -8, daysLate: 8 },
    { id: 'OWNER', status: 'Overdue', daysToDue: -1, daysLate: 1 },
    { id: 'DUE0', status: 'Open', daysToDue: 0 },
    { id: 'DUE3', status: 'Open', daysToDue: 3 },
    { id: 'DUE4', status: 'Open', daysToDue: 4 },
    { id: 'DUE7', status: 'Open', daysToDue: 7 },
    { id: 'DUE8', status: 'Open', daysToDue: 8 },
    { id: 'GAP', status: 'Open', daysToDue: null },
  ]);

  assert.deepEqual(rows.map(({ key, value }) => [key, value]), [
    ['overdue-critical', 1],
    ['overdue', 1],
    ['due-soon', 2],
    ['due-next', 2],
    ['future', 1],
    ['gap', 1],
  ]);
  assert.equal(rows.reduce((sum, row) => sum + row.value, 0), 8);
});
