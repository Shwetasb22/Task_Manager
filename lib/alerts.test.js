const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanClientError, createThrottle, alertCard } = require('./alerts');

test('cleanClientError keeps known fields, cut to size', () => {
  const e = cleanClientError({ message: ` ${'x'.repeat(500)} `, stack: 's', url: 'http://a', kind: 'weird', extra: 'dropped', user: 7 });
  assert.equal(e.message.length, 299); // trimmed after cutting to 300
  assert.equal(e.kind, 'error');
  assert.equal(e.user, '');
  assert.equal('extra' in e, false);
});

test('cleanClientError refuses junk', () => {
  assert.equal(cleanClientError(null), null);
  assert.equal(cleanClientError('text'), null);
  assert.equal(cleanClientError({ message: '   ' }), null);
  assert.equal(cleanClientError({ message: 42 }), null);
});

test('throttle: one alert per problem per window, capped per hour', () => {
  const allow = createThrottle({ perKeyMs: 1000, maxPerHour: 3 });
  assert.equal(allow('a', 0), true);
  assert.equal(allow('a', 500), false);
  assert.equal(allow('a', 1500), true);
  assert.equal(allow('b', 1600), true);
  assert.equal(allow('c', 1700), false); // 3 already this hour
  assert.equal(allow('c', 60 * 60 * 1000 + 1), true);
});

test('alertCard is a Teams adaptive card with an optional link', () => {
  const c = alertCard('Down', ['one', '', 'two'], 'http://app');
  const card = c.attachments[0].content;
  assert.equal(card.type, 'AdaptiveCard');
  assert.equal(card.body.length, 3);
  assert.equal(card.actions[0].url, 'http://app');
  assert.equal(alertCard('x').attachments[0].content.actions, undefined);
});
