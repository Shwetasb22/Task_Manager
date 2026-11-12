import test from 'node:test';
import assert from 'node:assert/strict';
import { accessOf, isApproved, requestedRoleFor, SIGNUP_ROLES } from './access.js';

test('sign-up can only request owner or manager', () => {
  assert.deepEqual(SIGNUP_ROLES, ['Owner', 'Manager']);
  assert.equal(requestedRoleFor('Manager'), 'manager');
  assert.equal(requestedRoleFor('Owner'), 'owner');
  // Anything else, including an attempt to ask for Admin, falls back to the lowest role.
  assert.equal(requestedRoleFor('Admin'), 'owner');
  assert.equal(requestedRoleFor(undefined), 'owner');
});

test('access follows the profile status, and old databases mean approved', () => {
  assert.equal(accessOf({ status: 'pending' }), 'pending');
  assert.equal(accessOf({ status: 'rejected' }), 'rejected');
  assert.equal(accessOf({ status: 'approved' }), 'approved');
  assert.equal(accessOf({}), 'approved');
  assert.equal(accessOf(null), 'approved');
  assert.equal(accessOf({ status: 'something-else' }), 'approved');
});

test('a session is approved unless it says otherwise', () => {
  assert.equal(isApproved({ access: 'pending' }), false);
  assert.equal(isApproved({ access: 'rejected' }), false);
  assert.equal(isApproved({ access: 'approved' }), true);
  assert.equal(isApproved({ name: 'Demo Admin' }), true);
});
