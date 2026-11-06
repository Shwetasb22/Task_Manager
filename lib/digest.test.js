const test = require('node:test');
const assert = require('node:assert/strict');
const { digestFor, renderEmail, teamsCard, scopeFor } = require('./digest');

const today = new Date(2026, 9, 14); // 14 Oct 2026
const tasks = [
  { id: 'SI-1', manager: 'Sagar Ingle', program: 'P1', desc: 'late 10 days', owner: 'Anjali Iyer', due: '2026-10-04', closed: null },
  { id: 'SI-2', manager: 'Sagar Ingle', program: 'P2', desc: 'late 2 days', owner: 'Anjali / Rohan Mehta', due: '2026-10-12', closed: null },
  { id: 'SI-3', manager: 'Sagar Ingle', program: 'P3', desc: 'due tomorrow', owner: 'Rohan Mehta', due: '2026-10-15', closed: null },
  { id: 'SI-4', manager: 'Sagar Ingle', program: 'P4', desc: 'closed', owner: 'Anjali Iyer', due: '2026-10-01', closed: '2026-10-02' },
  { id: 'AK-1', manager: 'Akhil Deshmukh', program: 'P5', desc: 'no date <b>', owner: 'Anjali Iyer', due: null, closed: null },
  { id: 'AK-2', manager: 'Akhil Deshmukh', program: 'P6', desc: 'far away', owner: 'Meera', due: '2026-12-01', closed: null },
];

test('each role gets the issues it sees in the app', () => {
  assert.equal(scopeFor({ role: 'admin' }, tasks).length, 6);
  assert.deepEqual(scopeFor({ role: 'manager', manager_name: 'Akhil Deshmukh' }, tasks).map((t) => t.id), ['AK-1', 'AK-2']);
  assert.deepEqual(scopeFor({ role: 'manager', manager_name: null }, tasks), []);
  assert.deepEqual(scopeFor({ role: 'owner', name: 'Anjali Iyer', owner_aliases: [] }, tasks).map((t) => t.id), ['SI-1', 'SI-2', 'SI-4', 'AK-1']);
});

test('owner digest lists overdue (most late first), due soon and missing dates', () => {
  const d = digestFor({ role: 'owner', name: 'Anjali Iyer', email: 'a@x', owner_aliases: ['anjali iyer', 'anjali'] }, tasks, today);
  assert.deepEqual(d.overdue.map((t) => t.id), ['SI-1', 'SI-2']);
  assert.deepEqual(d.dueSoon.map((t) => t.id), []);
  assert.deepEqual(d.noDate.map((t) => t.id), ['AK-1']);
  assert.equal(d.worthSending, true);
  assert.deepEqual(d.trackers, []);
});

test('nothing to report means no email', () => {
  const d = digestFor({ role: 'owner', name: 'Meera', owner_aliases: ['meera'] }, tasks, today);
  assert.equal(d.worthSending, false);
});

test('manager and admin digests summarise by tracker', () => {
  const d = digestFor({ role: 'admin', name: 'Vishal' }, tasks, today);
  assert.deepEqual(d.trackers.map((r) => [r.tracker, r.open, r.overdue, r.l3, r.dueSoon]), [['Sagar Ingle', 3, 2, 1, 1], ['Akhil Deshmukh', 2, 0, 0, 0]]);
  assert.equal(d.l3.length, 1, 'L3 = more than 7 days late (same rule as the app)');
});

test('email is escaped and names the counts; Teams card has one row per tracker', () => {
  const d = digestFor({ role: 'admin', name: 'Naveen Sahni' }, tasks, today);
  const mail = renderEmail(d, { appUrl: 'http://10.91.50.252:3000', todayLabel: '14-Oct-26' });
  assert.equal(mail.subject, 'OPL morning update: 2 overdue, 1 due soon');
  assert.match(mail.html, /Good morning Naveen/);
  assert.match(mail.html, /no date &lt;b&gt;/);
  assert.doesNotMatch(mail.html, /no date <b>/);
  assert.match(mail.text, /OVERDUE 10d {2}SI-1/);
  const card = teamsCard(d, { appUrl: 'http://x' });
  assert.equal(card.attachments[0].content.body.find((b) => b.type === 'FactSet').facts.length, 2);
  assert.equal(card.attachments[0].content.actions[0].url, 'http://x');
});
