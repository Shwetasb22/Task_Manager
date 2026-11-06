#!/usr/bin/env node
// Watchdog, run by pm2 every 5 minutes (see ecosystem.config.js). Posts to the Teams channel in
// ALERT_TEAMS_WEBHOOK when:
//   - the app or its database stops answering (after 2 failed checks in a row), and again when it is back;
//   - the nightly backup has not been written for 2 days (once a day until it is fixed).
// Run by hand to see the current state:   node scripts/health-alert.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, stateDir } from './lib/server-env.mjs';
import alerts from '../lib/alerts.js';

const { alertCard, postTeams } = alerts;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = loadEnv(root);
const dir = stateDir(root, env);
const stateFile = path.join(dir, '.health-state.json');
const port = env.OPL_PORT || '3000';
const appUrl = env.APP_URL || '';

function readState() {
  try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return { fails: 0, down: false }; }
}

async function check() {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(10000) });
    const body = await r.json().catch(() => ({}));
    if (r.ok && body.ok) return { ok: true, detail: `release ${body.release || '?'}, database ${body.db}` };
    return { ok: false, detail: body.db && body.db !== 'ok' ? `the database is ${body.db === "unreachable" ? "unreachable" : `answering with ${body.db}`}` : `the app answered ${r.status}` };
  } catch (e) {
    return { ok: false, detail: `the app does not answer on port ${port} (${e.cause?.code || e.name})` };
  }
}

// Newest backup day folder (scripts/backup.mjs writes <state>/backups/YYYY-MM-DD).
function lastBackup() {
  const b = path.join(dir, 'backups');
  if (!fs.existsSync(b)) return null;
  const days = fs.readdirSync(b).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && fs.existsSync(path.join(b, d, 'data.json.gz'))).sort();
  return days.length ? days[days.length - 1] : null;
}

async function send(title, lines) {
  console.log(`${title}\n  ${lines.join('\n  ')}`);
  if (!env.ALERT_TEAMS_WEBHOOK) { console.log('  (ALERT_TEAMS_WEBHOOK is not set, so nothing was posted)'); return; }
  await postTeams(env.ALERT_TEAMS_WEBHOOK, alertCard(title, lines, appUrl));
}

async function main() {
  const state = readState();
  const now = new Date();
  const result = await check();
  console.log(`${now.toISOString()} ${result.ok ? 'OK' : 'FAIL'}: ${result.detail}`);

  if (result.ok) {
    if (state.down) await send('OPL tracker is working again', [`Back at ${now.toLocaleString()}; it was down since ${new Date(state.since).toLocaleString()}.`, result.detail]);
    state.fails = 0; state.down = false; delete state.since;
  } else {
    state.fails = (state.fails || 0) + 1;
    if (!state.down && state.fails >= 2) {
      state.down = true; state.since = now.toISOString();
      await send('OPL tracker is down', [result.detail, 'People cannot use the app. On the server: pm2 status, then pm2 logs opl-tracker. If an update caused it: scripts/deploy --rollback.']);
    }
  }

  // Backup check, only when backups are expected (opl-backup runs every night).
  const last = lastBackup();
  const today = now.toLocaleDateString('en-CA');
  const ageDays = last ? Math.floor((Date.parse(today) - Date.parse(last)) / 86400000) : null;
  if (ageDays !== null && ageDays >= 2 && state.backupWarned !== today) {
    state.backupWarned = today;
    await send('OPL tracker backups have stopped', [`The last backup is from ${last} (${ageDays} days ago).`, 'On the server: pm2 logs opl-backup.']);
  }
  fs.writeFileSync(stateFile, JSON.stringify(state));
}

main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
