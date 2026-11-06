#!/usr/bin/env node
// Optional Teams channel card for daily overdue and soon-due issues; routine daily emails are disabled.
// Weekly report emails still run on Mondays (see ecosystem.config.js).
//
//   node scripts/daily-digest.mjs --dry-run           write the emails to ./digest-preview, send nothing
//   node scripts/daily-digest.mjs --only you@bremboindia.com   send only to one person (testing)
//   node scripts/daily-digest.mjs                     send to everyone who has it switched on
//   node scripts/daily-digest.mjs --weekly            the Monday weekly report instead (admins and managers)
//
// Settings come from .env.local (see .env.example): SUPABASE_SERVICE_ROLE_KEY, DIGEST_SMTP_*,
// DIGEST_FROM, DIGEST_TEAMS_WEBHOOK, APP_URL. Without SMTP settings, email is skipped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, serviceClient, fetchAll, mapTaskRow, stateDir } from './lib/server-env.mjs';
import digestLib from '../lib/digest.js';
import reportLib from '../lib/report.js';
import { startOfToday, fmtShort, fmtDate } from '../lib/rules.js';

const { digestFor, renderEmail, teamsCard, scopeFor } = digestLib;
const { weeklyReport, renderReportEmail } = reportLib;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const weekly = args.includes('--weekly');
const only = args.includes('--only') ? String(args[args.indexOf('--only') + 1] || '').toLowerCase() : null;
const env = loadEnv(root);

function isWorkingDay(d) {
  const skip = String(env.DIGEST_SKIP_DAYS ?? '0').split(',').map((x) => Number(x.trim())); // 0 = Sunday
  return !skip.includes(d.getDay());
}

// pm2 also runs a cron job once when it is started or reloaded (for example after an update), so a
// scheduled run sends at most once a day and never before DIGEST_HOUR (default 8).
const stampFile = path.join(stateDir(root, env), weekly ? '.weekly-last-sent' : '.digest-last-sent');
function alreadyRanToday(today) {
  if (process.env.pm_id === undefined || args.includes('--force') || dryRun || only) return false;
  if (weekly && today.getDay() !== 1) { console.log('The weekly report goes out on Mondays; skipped.'); return true; }
  if (new Date().getHours() < Number(env.DIGEST_HOUR || 8)) { console.log('Too early for the morning email; skipped.'); return true; }
  const last = fs.existsSync(stampFile) ? fs.readFileSync(stampFile, 'utf8').trim() : '';
  if (last === fmtDate(today)) { console.log('The morning email was already sent today; skipped.'); return true; }
  return false;
}

async function main() {
  const today = startOfToday();
  if (!weekly && !isWorkingDay(today) && !args.includes('--force')) { console.log('Not a working day, nothing sent.'); return; }
  if (alreadyRanToday(today)) return;
  const db = serviceClient(env);
  const [taskRows, people] = await Promise.all([
    // The weekly report also needs issues closed in the last two weeks.
    fetchAll(db, 'tasks', 'id, manager, program, description, dept, customer, owner, member, start_date, due_date, next_date, closed_date, remark, custom, created_at',
      (q) => (weekly ? q.or(`closed_date.is.null,closed_date.gte.${fmtDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 15))}`) : q.is('closed_date', null))),
    fetchAll(db, 'profiles', '*'),
  ]);
  const tasks = taskRows.filter((r) => !r.archived_at).map(mapTaskRow);
  const appUrl = env.APP_URL || '';
  const todayLabel = fmtShort(fmtDate(today));
  const outDir = path.join(root, 'digest-preview');
  if (dryRun) fs.mkdirSync(outDir, { recursive: true });

  let transport = null;
  if (weekly && !dryRun && env.DIGEST_SMTP_HOST) {
    const nodemailer = (await import('nodemailer')).default;
    transport = nodemailer.createTransport({
      host: env.DIGEST_SMTP_HOST,
      port: Number(env.DIGEST_SMTP_PORT || 25),
      secure: String(env.DIGEST_SMTP_SECURE || 'false') === 'true',
      auth: env.DIGEST_SMTP_USER ? { user: env.DIGEST_SMTP_USER, pass: env.DIGEST_SMTP_PASS } : undefined,
      tls: { rejectUnauthorized: String(env.DIGEST_SMTP_STRICT_TLS || 'true') === 'true' },
    });
  } else if (weekly && !dryRun) {
    console.log('DIGEST_SMTP_HOST is not set, so no weekly emails are sent.');
  }

  let sent = 0; let skipped = 0; const failed = [];
  for (const person of people) {
    if (!weekly) { skipped += 1; continue; }
    if (!person.email) { skipped += 1; continue; }
    if (person.role === 'manager' && !person.manager_name) { skipped += 1; continue; }
    if (only && person.email.toLowerCase() !== only) continue;
    let mail;
    if (weekly) {
      if (person.role === 'owner') { skipped += 1; continue; }
      // The week that ended yesterday (Sunday when sent on Monday).
      const report = weeklyReport(scopeFor(person, tasks), new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
      mail = renderReportEmail(report, { appUrl, scopeLabel: person.role === 'admin' ? 'All trackers' : `${person.manager_name}'s tracker`, showTrackers: person.role === 'admin' });
    } else {
      const digest = digestFor(person, tasks, today);
      if (!digest.worthSending) { skipped += 1; continue; }
      mail = renderEmail(digest, { appUrl, todayLabel });
    }
    if (dryRun) {
      fs.writeFileSync(path.join(outDir, `${weekly ? 'weekly-' : ''}${person.email.replace(/[^a-z0-9.@_-]/gi, '_')}.html`), mail.html);
      sent += 1;
      continue;
    }
    if (!transport) continue;
    try {
      await transport.sendMail({ from: env.DIGEST_FROM || env.DIGEST_SMTP_USER, to: person.email, subject: mail.subject, html: mail.html, text: mail.text || undefined });
      sent += 1;
    } catch (e) {
      failed.push(`${person.email}: ${e.message}`);
    }
  }

  if (env.DIGEST_TEAMS_WEBHOOK && !only && !weekly) {
    const card = teamsCard(digestFor({ role: 'admin', name: 'Team' }, tasks, today), { appUrl, todayLabel });
    if (dryRun) fs.writeFileSync(path.join(outDir, 'teams-card.json'), JSON.stringify(card, null, 2));
    else {
      const r = await fetch(env.DIGEST_TEAMS_WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(card) });
      if (!r.ok) failed.push(`Teams: HTTP ${r.status} ${await r.text().catch(() => '')}`.slice(0, 300));
      else console.log('Teams card posted.');
    }
  }

  if (!dryRun && !only) fs.writeFileSync(stampFile, fmtDate(today));
  console.log(`${dryRun ? 'Previewed' : 'Sent'} ${sent} email(s), skipped ${skipped}${failed.length ? `, ${failed.length} failed` : ''}.${dryRun ? ` See ${outDir}` : ''}`);
  if (failed.length) { failed.forEach((f) => console.error(`  ${f}`)); process.exitCode = 1; }
}

main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
