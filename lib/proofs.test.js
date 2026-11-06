const test = require('node:test');
const assert = require('node:assert/strict');
const proofs = import('./proofs.js');

const owner = { id: 'u-1', role: 'Owner', name: 'Yash', display: 'Yash Patil' };
const openTask = { id: 'SI-1', owner: 'Yash', status: 'Open', closed: null };
const mine = { id: 'p-1', name: 'a.pdf', by: 'Yash Patil', byId: 'u-1' };

test('canRemoveProof lets managers and admins remove any visible proof', async () => {
  const { canRemoveProof } = await proofs;
  const other = { ...mine, byId: 'u-9', by: 'Someone' };
  assert.equal(canRemoveProof({ role: 'Manager', name: 'Sagar Ingle' }, { ...openTask, status: 'Closed' }, other), true);
  assert.equal(canRemoveProof({ role: 'Admin', name: 'Admin' }, openTask, other), true);
});

test('canRemoveProof lets an owner remove only their own upload on an open issue', async () => {
  const { canRemoveProof } = await proofs;
  assert.equal(canRemoveProof(owner, openTask, mine), true);
  assert.equal(canRemoveProof(owner, openTask, { ...mine, byId: 'u-9' }), false);
  assert.equal(canRemoveProof(owner, { ...openTask, status: 'Closed', closed: '2026-10-01' }, mine), false);
  assert.equal(canRemoveProof(owner, { ...openTask, owner: 'Someone else' }, mine), false);
});

test('canRemoveProof falls back to the uploader name when no uploader id is stored', async () => {
  const { canRemoveProof } = await proofs;
  const legacy = { id: 'p-2', name: 'b.pdf', by: 'Yash Patil' };
  assert.equal(canRemoveProof(owner, openTask, legacy), true);
  assert.equal(canRemoveProof(owner, openTask, { ...legacy, by: 'Manager' }), false);
  assert.equal(canRemoveProof(null, openTask, legacy), false);
});
