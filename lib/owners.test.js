const test = require('node:test');
const assert = require('node:assert/strict');
const { ownerTokens, aliasesForName, ownsTask, isOwnerOf } = require('./owners');

test('ownerTokens splits shared Owner cells and ignores case and spacing', () => {
  assert.deepEqual(ownerTokens(' Anjali  Iyer / Chetan Salunke,Amit Jadhav '), ['anjali iyer', 'chetan salunke', 'amit jadhav']);
  assert.deepEqual(ownerTokens(''), []);
});

test('aliasesForName covers full, reversed and first name', () => {
  assert.deepEqual(aliasesForName('Abhijit Mendki'), ['abhijit mendki', 'mendki abhijit', 'abhijit']);
});

test('an owner owns every spelling and shared cell that names them', () => {
  const aliases = aliasesForName('Anjali Iyer');
  assert.equal(ownsTask('Anjali', aliases), true);
  assert.equal(ownsTask('Iyer Anjali', aliases), true);
  assert.equal(ownsTask('Rashmi Iyer / Anjali Iyer', aliases), true);
  assert.equal(ownsTask('Anjali Sharma', aliases), false);
  assert.equal(ownsTask('Meera', aliases), false);
});

test('isOwnerOf prefers the aliases stored by the database', () => {
  const session = { role: 'Owner', name: 'Yogita Salunkhe', aliases: ['yogita salunkhe', 'yogita salunke'] };
  assert.equal(isOwnerOf(session, { owner: 'Yogita Salunke' }), true);
  assert.equal(isOwnerOf({ ...session, role: 'Manager' }, { owner: 'Yogita Salunke' }), false);
});
