// Error alerts: shared by /api/client-error (errors in people's browsers) and scripts/health-alert.mjs
// (app or database down). Alerts go to a Teams channel (ALERT_TEAMS_WEBHOOK) and to the server log.

const LIMITS = { message: 300, stack: 2000, url: 300, user: 80, agent: 200 };

function clip(v, n) {
  return typeof v === 'string' ? v.slice(0, n) : '';
}

// Keeps only the fields we expect from the browser, cut to a sane size. Returns null for junk.
function cleanClientError(body) {
  if (!body || typeof body !== 'object') return null;
  const message = clip(body.message, LIMITS.message).trim();
  if (!message) return null;
  return {
    kind: ['error', 'rejection', 'render'].includes(body.kind) ? body.kind : 'error',
    message,
    stack: clip(body.stack, LIMITS.stack),
    url: clip(body.url, LIMITS.url),
    user: clip(body.user, LIMITS.user),
    agent: clip(body.agent, LIMITS.agent),
  };
}

// The same problem is alerted at most once per `perKeyMs`, and at most `maxPerHour` alerts in total,
// so a bug hitting everyone at once sends one message, not hundreds.
function createThrottle({ perKeyMs = 30 * 60 * 1000, maxPerHour = 10 } = {}) {
  const lastByKey = new Map();
  let sent = [];
  return function allow(key, now = Date.now()) {
    sent = sent.filter((t) => now - t < 60 * 60 * 1000);
    const last = lastByKey.get(key);
    if (last !== undefined && now - last < perKeyMs) return false;
    if (sent.length >= maxPerHour) return false;
    lastByKey.set(key, now);
    if (lastByKey.size > 500) lastByKey.delete(lastByKey.keys().next().value);
    sent.push(now);
    return true;
  };
}

// A Teams card (same format as the morning update card).
function alertCard(title, lines = [], appUrl = '') {
  const body = [
    { type: 'TextBlock', size: 'Large', weight: 'Bolder', wrap: true, text: title },
    ...lines.filter(Boolean).map((text) => ({ type: 'TextBlock', wrap: true, spacing: 'Small', text })),
  ];
  const card = { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body };
  if (appUrl) card.actions = [{ type: 'Action.OpenUrl', title: 'Open the app', url: appUrl }];
  return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: card }] };
}

async function postTeams(webhook, card) {
  if (!webhook) return false;
  const r = await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(card), signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`Teams answered ${r.status}`);
  return true;
}

module.exports = { cleanClientError, createThrottle, alertCard, postTeams };
