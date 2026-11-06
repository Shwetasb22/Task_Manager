const test = require('node:test');
const assert = require('node:assert/strict');
const { isEscalationRecipient, ESCALATION_LABELS, escalationsFor, escalationTarget, countByLevel } = require('./escalations');

const issue = { id: 'ES-1', owner: 'Riya Patel / Amit Rao', manager: 'Sagar Ingle', dept: 'PRGM', status: 'Overdue' };

test('L1 escalation is delivered only to the assigned owner', () => {
  assert.equal(isEscalationRecipient({ ...issue, esc: 'L1 Owner' }, { role: 'Owner', name: 'Riya Patel' }), true);
  assert.equal(isEscalationRecipient({ ...issue, esc: 'L1 Owner' }, { role: 'Owner', name: 'Other Person' }), false);
  assert.equal(isEscalationRecipient({ ...issue, esc: 'L1 Owner' }, { role: 'Manager', name: 'Sagar Ingle' }), false);
});

test('L2 escalation is delivered to the manager of the matching tracker', () => {
  assert.equal(isEscalationRecipient({ ...issue, esc: 'L2 Manager' }, { role: 'Manager', name: 'sagar  ingle' }), true);
  assert.equal(isEscalationRecipient({ ...issue, esc: 'L2 Manager' }, { role: 'Manager', name: 'Other Manager' }), false);
});

test('L3 escalation is delivered to the matching department head', () => {
  assert.equal(isEscalationRecipient({ ...issue, esc: 'L3 HOD' }, { role: 'Dept Head', name: 'Head', dept: 'PRGM' }), true);
  assert.equal(isEscalationRecipient({ ...issue, esc: 'L3 HOD' }, { role: 'Dept Head', name: 'Head', dept: 'QE' }), false);
  assert.equal(isEscalationRecipient({ ...issue, esc: 'L3 HOD' }, { role: 'Manager', name: 'Sagar Ingle' }), false);
});

test('Admins receive escalation oversight; closed and unassigned levels do not notify', () => {
  assert.equal(isEscalationRecipient({ ...issue, esc: 'L3 HOD' }, { role: 'Admin', name: 'Admin' }), true);
  assert.equal(isEscalationRecipient({ ...issue, esc: 'L1 Owner', status: 'Closed' }, { role: 'Owner', name: 'Riya Patel' }), false);
  assert.equal(isEscalationRecipient({ ...issue, esc: 'Neutral' }, { role: 'Admin', name: 'Admin' }), false);
  assert.deepEqual(ESCALATION_LABELS, { 'L1 Owner': 'L1 · Owner', 'L2 Manager': 'L2 · Manager', 'L3 HOD': 'L3 · Dept Head' });
});

test('escalationsFor returns only my escalations, most severe first, and counts them by level', () => {
  const tasks = [
    { ...issue, id: 'A', esc: 'L2 Manager', escRating: 2 },
    { ...issue, id: 'B', esc: 'L3 HOD', escRating: 3, daysLate: 9 },
    { ...issue, id: 'C', esc: 'L3 HOD', escRating: 3, daysLate: 12 },
    { ...issue, id: 'D', esc: 'L1 Owner', escRating: 1 },
    { ...issue, id: 'E', esc: 'L1 Owner', escRating: 1, status: 'Closed' },
  ];
  const admin = escalationsFor(tasks, { role: 'Admin', name: 'Admin' });
  assert.deepEqual(admin.map((t) => t.id), ['C', 'B', 'A', 'D']);
  assert.deepEqual(countByLevel(admin), { 'L3 HOD': 2, 'L2 Manager': 1, 'L1 Owner': 1 });
  assert.deepEqual(escalationsFor(tasks, { role: 'Owner', name: 'Amit Rao' }).map((t) => t.id), ['D']);
});

test('escalationTarget names who the escalation goes to', () => {
  assert.equal(escalationTarget({ ...issue, esc: 'L1 Owner' }), 'Owner: Riya Patel / Amit Rao');
  assert.equal(escalationTarget({ ...issue, esc: 'L2 Manager' }), 'Manager: Sagar Ingle');
  assert.equal(escalationTarget({ ...issue, esc: 'L3 HOD' }), 'Dept Head: PRGM');
  assert.equal(escalationTarget({ ...issue, esc: 'Neutral' }), '');
});
