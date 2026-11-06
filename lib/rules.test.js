const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveTask, parseDate, dueSoonAlerts, getTaskStatusPresentation, getTaskRowTone, rygbOf, RYGB, RYGB_ORDER } = require('./rules');

test('closed task stays closed and blue', () => {
  const task = deriveTask({ due: '2026-09-10', closed: '2026-09-08' }, parseDate('2026-09-09'));
  assert.equal(task.status, 'Closed');
  assert.equal(task.rgy, 'Blue');
  assert.equal(task.esc, 'None');
});

test('missing due date is grey (no target date)', () => {
  const task = deriveTask({ due: null, closed: null }, parseDate('2026-09-09'));
  assert.equal(task.status, 'Open');
  assert.equal(task.rgy, 'Grey');
  assert.equal(task.sev, 'Critical - Data Gap');
  assert.equal(task.flag, true);
  assert.equal(task.daysToDue, null);
  assert.equal(task.daysLate, null);
  assert.deepEqual(dueSoonAlerts([task]), []);
});

test('task due within three days is a level-two warning', () => {
  const today = parseDate('2026-09-01');
  const task = deriveTask({ due: '2026-09-03', closed: null }, today);
  assert.equal(task.status, 'Open');
  assert.equal(task.rgy, 'Yellow');
  assert.equal(task.esc, 'L2 Manager');
});

test('future active issue is Green On Track outside the three-day due-soon window', () => {
  const task = deriveTask({ due: '2026-09-15', closed: null }, parseDate('2026-09-01'));
  assert.equal(task.status, 'Open');
  assert.equal(task.rgy, 'Green');
  assert.equal(task.esc, 'Neutral');
  assert.deepEqual(getTaskStatusPresentation(task), { label: 'On Track', tone: 'Green' });
});

test('visual status keeps closed blue, overdue red, and missing-date issues grey', () => {
  const today = parseDate('2026-09-10');
  const closed = deriveTask({ due: '2026-09-09', closed: '2026-09-10' }, today);
  const overdue = deriveTask({ due: '2026-09-09', closed: null }, today);
  const gap = deriveTask({ due: null, closed: null }, today);

  assert.deepEqual(getTaskStatusPresentation(closed), { label: 'Closed', tone: 'Blue' });
  assert.deepEqual(getTaskStatusPresentation(overdue), { label: 'Overdue', tone: 'Red' });
  assert.deepEqual(getTaskStatusPresentation(gap), { label: 'No Target Date', tone: 'Grey' });
});

test('RYGB boundaries: overdue red, 0-3 days yellow, 4+ days green, closed blue, no date grey', () => {
  const today = parseDate('2026-09-10');
  const at = (due, closed = null) => deriveTask({ due, closed }, today);
  assert.equal(at('2026-09-09').rgy, 'Red'); // 1 day late
  assert.equal(at('2026-09-10').rgy, 'Yellow'); // due today
  assert.equal(at('2026-09-13').rgy, 'Yellow'); // 3 days left
  assert.equal(at('2026-09-14').rgy, 'Green'); // 4 days left
  assert.equal(at('2026-09-01', '2026-09-05').rgy, 'Blue');
  assert.equal(at(null).rgy, 'Grey');
  assert.deepEqual(RYGB_ORDER, ['Red', 'Yellow', 'Green', 'Blue', 'Grey']);
  assert.deepEqual(RYGB_ORDER.map((k) => RYGB[k].label), ['Overdue', 'Due Soon', 'On Track', 'Closed', 'No Target Date']);
});

test('row colours and rygbOf work from derived fields alone', () => {
  assert.equal(getTaskRowTone({ status: 'Closed', daysToDue: 1 }), 'Blue');
  assert.equal(getTaskRowTone({ status: 'Overdue', daysToDue: -1 }), 'Red');
  assert.equal(getTaskRowTone({ status: 'Open', daysToDue: 3 }), 'Yellow');
  assert.equal(getTaskRowTone({ status: 'Open', daysToDue: 4 }), 'Green');
  assert.equal(getTaskRowTone({ status: 'Open', daysToDue: 27 }), 'Green');
  assert.equal(getTaskRowTone({ status: 'Open', daysToDue: null }), 'Grey');
  assert.equal(rygbOf(null), 'Grey');
});

test('overdue task escalates to management when more than 7 days late', () => {
  const today = parseDate('2026-09-20');
  const task = deriveTask({ due: '2026-08-25', closed: null }, today);
  assert.equal(task.status, 'Overdue');
  assert.equal(task.rgy, 'Red');
  assert.equal(task.esc, 'L3 HOD');
  assert.equal(task.escRating, 3);
  assert.equal(task.sev, 'Critical');
  assert.equal(task.flag, true);
});

test('bell alert list only includes open issues due today through five days out', () => {
  const tasks = [
    { id: 'A0', status: 'Open', rgy: 'Yellow', daysToDue: 0 },
    { id: 'A1', status: 'Open', rgy: 'Red', daysToDue: 2 },
    { id: 'A2', status: 'Open', rgy: 'Green', daysToDue: 5 },
    { id: 'A3', status: 'Open', rgy: 'Yellow', daysToDue: 6 },
    { id: 'A4', status: 'Overdue', rgy: 'Red', daysToDue: -2 },
    { id: 'A5', status: 'Closed', rgy: 'Green', daysToDue: 1 },
    { id: 'A6', status: 'Open', rgy: 'Grey', daysToDue: null },
  ];

  const alerts = dueSoonAlerts(tasks, 5);
  assert.deepEqual(alerts.map((t) => t.id), ['A0', 'A1', 'A2']);
});
