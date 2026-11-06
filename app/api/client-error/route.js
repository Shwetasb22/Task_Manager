// Errors that happen in people's browsers are sent here (components/ErrorReporter.js), written to the
// server log (`pm2 logs opl-tracker`), and posted to Teams when ALERT_TEAMS_WEBHOOK is set in .env.local.
// The same error is posted at most once every 30 minutes, and at most 10 posts an hour.
import alerts from '../../../lib/alerts';

const { cleanClientError, createThrottle, alertCard, postTeams } = alerts;
const teamsThrottle = createThrottle();
const perIp = new Map(); // ip -> [timestamps], at most 30 reports a minute from one computer

function tooMany(ip, now) {
  const recent = (perIp.get(ip) || []).filter((t) => now - t < 60000);
  recent.push(now);
  perIp.set(ip, recent);
  if (perIp.size > 1000) perIp.delete(perIp.keys().next().value);
  return recent.length > 30;
}

export async function POST(req) {
  const now = Date.now();
  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'local';
  if (tooMany(ip, now)) return new Response(null, { status: 429 });
  const text = await req.text();
  if (text.length > 8000) return new Response(null, { status: 413 });
  let report;
  try { report = cleanClientError(JSON.parse(text)); } catch { report = null; }
  if (!report) return new Response(null, { status: 400 });

  console.error(`[client-error] ${JSON.stringify({ at: new Date(now).toISOString(), ip, ...report })}`);

  const webhook = process.env.ALERT_TEAMS_WEBHOOK;
  if (webhook && teamsThrottle(`${report.kind}:${report.message}`, now)) {
    const firstFrame = report.stack.split('\n').find((l) => /at |@/.test(l)) || '';
    const card = alertCard('OPL tracker: an error in the app', [
      `**${report.message}**`,
      report.user ? `Seen by ${report.user}` : '',
      report.url ? `Page: ${report.url}` : '',
      firstFrame ? `Where: ${firstFrame.trim().slice(0, 200)}` : '',
      'Repeats of this error are not posted again for 30 minutes. Details: pm2 logs opl-tracker on the server.',
    ], process.env.APP_URL || '');
    postTeams(webhook, card).catch((e) => console.error(`[client-error] Teams alert failed: ${e.message}`));
  }
  return new Response(null, { status: 204 });
}
