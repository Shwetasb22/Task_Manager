const test = require('node:test');
const assert = require('node:assert/strict');
const { dueAcceptanceOf, maxRevisedDate, revisedDateError, sortMostOverdueFirst } = require('./due-policy');

test('owner has three days to accept a proposed target date, then it auto-accepts', () => {
  const today = new Date(2026, 10, 5, 8);
  const pending = dueAcceptanceOf({ due: '2026-11-10', dueAcceptance: 'pending', dueProposedAt: '2026-11-03T08:00:00' }, today);
  assert.equal(pending.status, 'pending');
  assert.equal(pending.remainingDays, 1);

  const auto = dueAcceptanceOf({ due: '2026-11-10', dueAcceptance: 'pending', dueProposedAt: '2026-11-02T08:00:00' }, today);
  assert.equal(auto.status, 'auto_accepted');
  assert.equal(auto.auto, true);
});

test('a target-date response stays open until the exact 72-hour deadline', () => {
  const now = new Date(2026, 10, 5, 8);
  const beforeDeadline = dueAcceptanceOf({ due: '2026-11-10', dueAcceptance: 'pending', dueProposedAt: '2026-11-02T08:00:01' }, now);
  const atDeadline = dueAcceptanceOf({ due: '2026-11-10', dueAcceptance: 'pending', dueProposedAt: '2026-11-02T08:00:00' }, now);
  assert.equal(beforeDeadline.status, 'pending');
  assert.equal(atDeadline.status, 'auto_accepted');
});

test('a pending record without proposal time is not auto-accepted from its creation time', () => {
  const result = dueAcceptanceOf({ due: '2026-11-10', dueAcceptance: 'pending', createdAt: '2026-10-01T08:00:00' }, new Date(2026, 10, 5, 8));
  assert.equal(result.status, 'pending');
  assert.equal(result.remainingDays, 3);
});

test('existing issues without an acceptance field stay accepted', () => {
  const result = dueAcceptanceOf({ due: '2026-11-10' }, new Date(2026, 10, 5));
  assert.equal(result.status, 'accepted');
});

test('revised date cannot move more than seven days past the target date', () => {
  assert.equal(maxRevisedDate('2026-11-10'), '2026-11-17');
  assert.equal(revisedDateError('2026-11-10', '2026-11-17'), null);
  assert.match(revisedDateError('2026-11-10', '2026-11-18'), /7 days/);
});

test('open overdue issues sort above later work', () => {
  const sorted = sortMostOverdueFirst([
    { id: 'A', status: 'Open', daysLate: 0, daysToDue: 4 },
    { id: 'B', status: 'Overdue', daysLate: 12, daysToDue: -12 },
    { id: 'C', status: 'Closed', daysLate: 0, daysToDue: null },
    { id: 'D', status: 'Overdue', daysLate: 3, daysToDue: -3 },
  ]);
  assert.deepEqual(sorted.map((t) => t.id), ['B', 'D', 'A', 'C']);
});
