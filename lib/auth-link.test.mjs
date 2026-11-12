import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthLink } from './auth-link.js';

test('a password-reset link is recognised', () => {
  assert.deepEqual(parseAuthLink('#access_token=abc&refresh_token=def&type=recovery', ''), { recovery: true, error: null });
});

test('an expired or already-used link gives a clear message', () => {
  const link = parseAuthLink('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', '');
  assert.equal(link.recovery, false);
  assert.match(link.error, /expired or was already used/);
});

test('other errors keep the reason from the link', () => {
  assert.match(parseAuthLink('#error=server_error&error_code=unexpected_failure&error_description=Something+broke', '').error, /Something broke/);
});

test('ordinary pages are left alone', () => {
  assert.deepEqual(parseAuthLink('', ''), { recovery: false, error: null });
  assert.deepEqual(parseAuthLink('#section', '?tab=register'), { recovery: false, error: null });
});
