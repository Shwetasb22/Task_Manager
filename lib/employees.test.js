const test = require('node:test');
const assert = require('node:assert/strict');
const {
  levenshtein, closestEmployee, employeesFromOwners, ownerSegments, withSuggestion, suggestEmployees,
  unknownOwnerNames, replaceOwnerName, ownerSpellingsReport,
} = require('./employees');

const people = [
  { name: 'Yogita Salunkhe', email: 'yogita.salunkhe@bremboindia.com', active: true },
  { name: 'Anjali Iyer', active: true },
  { name: 'Ajay Jadhav', active: true },
  { name: 'Old Leaver', active: false },
];

test('levenshtein counts single-letter edits', () => {
  assert.equal(levenshtein('salunke', 'salunkhe'), 1);
  assert.equal(levenshtein('abc', 'abc'), 0);
  assert.equal(levenshtein('', 'ab'), 2);
});

test('the employee list is built like the migration: full names first, variants and first names skipped', () => {
  const list = employeesFromOwners(['Ajay', 'Ajay Jadhav / yogita salunke', 'Yogita Salunkhe', 'Unassigned', 'Meera', 'Jadhav Ajay'])
    .map((e) => e.name);
  assert.deepEqual(list, ['Ajay Jadhav', 'Yogita Salunke', 'Meera']);
});

test('closestEmployee finds the listed person a tracker spelling means', () => {
  assert.equal(closestEmployee('Yogita Salunke', people).name, 'Yogita Salunkhe');
  assert.equal(closestEmployee('Iyer Anjali', people).name, 'Anjali Iyer');
  assert.equal(closestEmployee('Ajay', people).name, 'Ajay Jadhav');
  assert.equal(closestEmployee('Rohan Mehta', people), null);
  assert.equal(closestEmployee('Ajay', [...people, { name: 'Ajay Kulkarni' }]), null, 'two Ajays: no guess');
});

test('the picker suggests for the name being typed after the last separator', () => {
  assert.deepEqual(ownerSegments('Anjali Iyer / Yog'), { done: ['Anjali Iyer'], current: 'Yog' });
  assert.equal(withSuggestion('Anjali Iyer / Yog', 'Yogita Salunkhe'), 'Anjali Iyer / Yogita Salunkhe');
  assert.equal(withSuggestion('', 'Ajay Jadhav'), 'Ajay Jadhav');
  assert.deepEqual(suggestEmployees(people, 'jad').map((e) => e.name), ['Ajay Jadhav']);
  assert.deepEqual(suggestEmployees(people, 'yogita.s').map((e) => e.name), ['Yogita Salunkhe']);
  assert.deepEqual(suggestEmployees(people, '', ['Anjali Iyer']).map((e) => e.name), ['Ajay Jadhav', 'Yogita Salunkhe']);
  assert.deepEqual(suggestEmployees(people, 'old'), [], 'inactive people are not suggested');
});

test('unknown names are reported, listed ones are not', () => {
  assert.deepEqual(unknownOwnerNames('anjali  iyer / Rohan Mehta / Unassigned', people), ['Rohan Mehta']);
});

test('replaceOwnerName swaps one spelling, keeps order and drops duplicates', () => {
  assert.equal(replaceOwnerName('Anjali Iyer / yogita salunke', 'Yogita Salunke', 'Yogita Salunkhe'), 'Anjali Iyer / Yogita Salunkhe');
  assert.equal(replaceOwnerName('Yogita Salunke, Yogita Salunkhe', 'Yogita Salunke', 'Yogita Salunkhe'), 'Yogita Salunkhe');
});

test('the spelling report lists unlisted names with a suggestion', () => {
  const report = ownerSpellingsReport([
    { manager: 'A', owner: 'Yogita Salunke' }, { manager: 'B', owner: 'Yogita Salunke / Anjali Iyer' }, { manager: 'A', owner: 'Rohan Mehta' },
  ], people);
  assert.equal(report.length, 2);
  assert.deepEqual({ ...report[0], suggestion: report[0].suggestion.name }, { name: 'Yogita Salunke', uses: 2, trackers: ['A', 'B'], suggestion: 'Yogita Salunkhe' });
  assert.equal(report[1].suggestion, null);
});
