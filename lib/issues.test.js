const test = require('node:test');
const assert = require('node:assert/strict');
const { validateNewIssue, nextIssueId, issuePrefix, sortNewestFirst, sortBySerial } = require('./issues');

const good = {
  manager: 'Sagar Ingle', customer: ' KTM ', program: 'KTM-OFF Road_FIX', desc: '  Fix   the drawing ',
  dept: 'PE', owner: ' Yash ', initialManager: 'Sagar Ingle', member: 'Resource A', start: '2026-10-08', due: '2026-10-15', next: '', remark: ' note ',
};

test('valid issue is tidied and accepted', () => {
  const r = validateNewIssue(good);
  assert.equal(r.ok, true);
  assert.equal(r.issue.desc, 'Fix the drawing');
  assert.equal(r.issue.owner, 'Yash');
  assert.equal(r.issue.customer, 'KTM');
  assert.equal(r.issue.initialManager, 'Sagar Ingle');
  assert.equal(r.issue.member, 'Resource A');
  assert.equal(r.issue.next, null);
  assert.equal(r.issue.remark, 'note');
});

test('resource name can be blank and is not copied from the owner', () => {
  const r = validateNewIssue({ ...good, member: '' });
  assert.equal(r.ok, true);
  assert.equal(r.issue.owner, 'Yash');
  assert.equal(r.issue.member, '');
});

test('target date is required', () => {
  const r = validateNewIssue({ ...good, due: '' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.due);
});

test('revised date cannot exceed the 7-day window', () => {
  const r = validateNewIssue({ ...good, due: '2026-10-15', next: '2026-10-23' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.next);
});

test('required fields are reported', () => {
  const r = validateNewIssue({ manager: '', program: ' ', desc: '', dept: '', owner: '', start: '' });
  assert.equal(r.ok, false);
  ['manager', 'program', 'desc', 'dept', 'owner', 'start'].forEach((k) => assert.ok(r.errors[k], k));
});

test('target date before start date is rejected', () => {
  const r = validateNewIssue({ ...good, start: '2026-10-10', due: '2026-10-09' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.due);
});

test('next id continues the tracker prefix and ignores gaps', () => {
  const tasks = [
    { id: 'AB-1', manager: 'Abhijit Mendki' }, { id: 'AB-204', manager: 'Abhijit Mendki' },
    { id: 'SI-9', manager: 'Sagar Ingle' }, { id: 'SI-10', manager: 'Sagar Ingle' },
  ];
  assert.equal(nextIssueId(tasks, 'Abhijit Mendki'), 'AB-205');
  assert.equal(nextIssueId(tasks, 'Sagar Ingle'), 'SI-11');
});

test('numbers of deleted issues are not given out again', () => {
  const tasks = [{ id: 'SI-3', manager: 'Sagar Ingle' }];
  assert.equal(nextIssueId(tasks, 'Sagar Ingle', ['SI-9', 'AB-50']), 'SI-10');
});

test('new tracker falls back to initials', () => {
  assert.equal(issuePrefix([], 'Vishal Shinde'), 'VS');
  assert.equal(nextIssueId([], 'Vishal Shinde'), 'VS-1');
  assert.equal(issuePrefix([], 'Abhijit Mendki'), 'AM');
});

test('newest issues sort first and ids break timestamp ties descending', () => {
  const tasks = [
    { id: 'SI-8', createdAt: '2026-10-08T10:00:00.000Z' },
    { id: 'SI-10', createdAt: '2026-10-08T10:00:00.000Z' },
    { id: 'SI-11', createdAt: '2026-10-08T11:00:00.000Z' },
    { id: 'SI-12' },
  ];

  assert.deepEqual(sortNewestFirst(tasks).map((task) => task.id), ['SI-11', 'SI-10', 'SI-8', 'SI-12']);
  assert.deepEqual(tasks.map((task) => task.id), ['SI-8', 'SI-10', 'SI-11', 'SI-12']);
});

test('editable serial numbers determine task order with issue id as a stable tie-breaker', () => {
  const tasks = [
    { id: 'SI-10', srNo: '10' }, { id: 'SI-2', srNo: '2' },
    { id: 'SI-3', srNo: '2' }, { id: 'SI-1', srNo: '' },
  ];
  assert.deepEqual(sortBySerial(tasks).map((task) => task.id), ['SI-2', 'SI-3', 'SI-10', 'SI-1']);
});
