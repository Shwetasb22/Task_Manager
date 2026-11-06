// Morning alert content: who gets which issues, and the email / Teams text. Uses the same rules as
// the app (lib/rules.js) and the same "whose issue is this" matching (lib/owners.js), so the email
// always agrees with what the person sees on screen. Sending is done by scripts/daily-digest.mjs.
const { deriveTask, fmtShort } = require('./rules.js');
const { ownsTask, aliasesForName } = require('./owners.js');

const LIST_LIMIT = 30;

const byLateness = (a, b) => (b.daysLate || 0) - (a.daysLate || 0) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
const bySoonest = (a, b) => a.daysToDue - b.daysToDue || String(a.id).localeCompare(String(b.id), undefined, { numeric: true });

// Issues a person can see, with the same scoping as the app and the database rules.
function scopeFor(person, tasks) {
  if (person.role === 'admin') return tasks;
  if (person.role === 'manager') return person.manager_name ? tasks.filter((t) => t.manager === person.manager_name) : [];
  const aliases = person.owner_aliases && person.owner_aliases.length ? person.owner_aliases : aliasesForName(person.owner_name || person.name);
  return tasks.filter((t) => ownsTask(t.owner, aliases));
}

// rawTasks use the app's field names (due, closed, owner, manager, ...).
function digestFor(person, rawTasks, today) {
  const open = scopeFor(person, rawTasks).map((t) => deriveTask(t, today)).filter((t) => t.status !== 'Closed');
  const overdue = open.filter((t) => t.status === 'Overdue').sort(byLateness);
  const dueSoon = open.filter((t) => t.daysToDue !== null && t.daysToDue >= 0 && t.daysToDue <= 3).sort(bySoonest);
  const noDate = open.filter((t) => t.rgy === 'Grey');
  const l3 = open.filter((t) => t.esc === 'L3 HOD');
  const trackers = {};
  if (person.role !== 'owner') {
    open.forEach((t) => {
      const row = trackers[t.manager] || (trackers[t.manager] = { tracker: t.manager, open: 0, overdue: 0, l3: 0, dueSoon: 0 });
      row.open += 1;
      if (t.status === 'Overdue') row.overdue += 1;
      if (t.esc === 'L3 HOD') row.l3 += 1;
      if (t.daysToDue !== null && t.daysToDue >= 0 && t.daysToDue <= 3) row.dueSoon += 1;
    });
  }
  return {
    person, open: open.length, overdue, dueSoon, noDate, l3,
    trackers: Object.values(trackers).sort((a, b) => b.overdue - a.overdue || a.tracker.localeCompare(b.tracker)),
    worthSending: overdue.length + dueSoon.length + noDate.length > 0,
  };
}

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function issueTable(title, rows, columns, total) {
  if (!rows.length) return '';
  const head = columns.map((c) => `<th style="text-align:left;padding:6px 8px;border-bottom:2px solid #c8102e;font-size:12px;color:#555">${esc(c.label)}</th>`).join('');
  const body = rows.slice(0, LIST_LIMIT).map((t) => `<tr>${columns.map((c) => `<td style="padding:6px 8px;border-bottom:1px solid #eee;font-size:13px;vertical-align:top${c.nowrap ? ';white-space:nowrap' : ''}">${esc(c.value(t))}</td>`).join('')}</tr>`).join('');
  const more = total > LIST_LIMIT ? `<p style="font-size:12px;color:#777;margin:4px 0 0">and ${total - LIST_LIMIT} more in the app.</p>` : '';
  return `<h3 style="font-size:15px;margin:22px 0 6px;color:#1c1418">${esc(title)}</h3><table style="border-collapse:collapse;width:100%">${`<tr>${head}</tr>`}${body}</table>${more}`;
}

function renderEmail(digest, { appUrl = '', todayLabel = '' } = {}) {
  const p = digest.person;
  const first = String(p.name || '').split(' ')[0] || 'there';
  const isOwner = p.role === 'owner';
  const cols = [
    { label: 'ID', value: (t) => t.id, nowrap: true },
    ...(isOwner ? [] : [{ label: 'Owner', value: (t) => t.owner }]),
    ...(p.role === 'admin' ? [{ label: 'Tracker', value: (t) => t.manager }] : []),
    { label: 'Program', value: (t) => t.program },
    { label: 'Issue', value: (t) => (String(t.desc || '').length > 90 ? `${String(t.desc).slice(0, 88)}…` : t.desc) },
    { label: 'Target', value: (t) => fmtShort(t.due), nowrap: true },
  ];
  const lateCols = [...cols, { label: 'Days late', value: (t) => t.daysLate, nowrap: true }];
  const soonCols = [...cols, { label: 'Due in', value: (t) => (t.daysToDue === 0 ? 'today' : `${t.daysToDue} day(s)`), nowrap: true }];
  const summary = `${plural(digest.overdue.length, 'overdue issue')}, ${plural(digest.dueSoon.length, 'issue')} due in the next 3 days${digest.noDate.length ? `, ${plural(digest.noDate.length, 'issue')} without a target date` : ''}.`;
  const subject = `OPL morning update: ${digest.overdue.length} overdue, ${digest.dueSoon.length} due soon`;
  const trackerTable = digest.trackers.length > 1 || p.role === 'admin'
    ? `<h3 style="font-size:15px;margin:22px 0 6px">By tracker</h3><table style="border-collapse:collapse"><tr>${['Tracker', 'Open', 'Overdue', 'L3 escalated', 'Due in 3 days'].map((h) => `<th style="text-align:left;padding:6px 10px;border-bottom:2px solid #c8102e;font-size:12px;color:#555">${h}</th>`).join('')}</tr>${digest.trackers.map((r) => `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px">${esc(r.tracker)}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px">${r.open}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px;color:${r.overdue ? '#9b1224' : '#333'}">${r.overdue}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px">${r.l3}</td><td style="padding:6px 10px;border-bottom:1px solid #eee;font-size:13px">${r.dueSoon}</td></tr>`).join('')}</table>`
    : '';
  const html = `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;color:#1c1418;max-width:900px;margin:0 auto;padding:16px">
<div style="border-top:4px solid #c8102e;padding-top:10px">${appUrl ? `<img src="${esc(`${appUrl.replace(/\/+$/, '')}/logo.png`)}" alt="BYBRE logo" width="36" height="36" style="vertical-align:middle;margin-right:8px">` : ''}<b style="color:#c8102e">Brembo India</b> · Program Command</div>
<h2 style="font-size:20px;margin:14px 0 4px">Good morning ${esc(first)}</h2>
<p style="font-size:14px;margin:0 0 6px">${esc(todayLabel ? `${todayLabel}: ` : '')}${esc(isOwner ? 'you have ' : 'your view has ')}${esc(summary)}</p>
${appUrl ? `<p style="margin:10px 0"><a href="${esc(appUrl)}" style="background:#c8102e;color:#fff;text-decoration:none;padding:8px 16px;border-radius:18px;font-size:13px;font-weight:bold">Open the Task Register</a></p>` : ''}
${trackerTable}
${issueTable('Overdue', digest.overdue, lateCols, digest.overdue.length)}
${issueTable('Due in the next 3 days', digest.dueSoon, soonCols, digest.dueSoon.length)}
${issueTable('No target date', digest.noDate, cols, digest.noDate.length)}
<p style="font-size:11px;color:#888;margin-top:26px">You get this email on working days. To stop it, switch off "Morning email" at the bottom of the menu in the app.</p>
</body></html>`;
  const lines = [`Good morning ${first}`, summary, ''];
  digest.overdue.slice(0, LIST_LIMIT).forEach((t) => lines.push(`OVERDUE ${t.daysLate}d  ${t.id}  ${t.program}: ${t.desc}`));
  digest.dueSoon.slice(0, LIST_LIMIT).forEach((t) => lines.push(`DUE ${fmtShort(t.due)}  ${t.id}  ${t.program}: ${t.desc}`));
  if (appUrl) lines.push('', appUrl);
  return { subject, html, text: lines.join('\n') };
}

// One Adaptive Card for a Teams channel (works with Teams "Workflows" and classic incoming webhooks).
function teamsCard(adminDigest, { appUrl = '', todayLabel = '' } = {}) {
  const facts = adminDigest.trackers.map((r) => ({ title: r.tracker, value: `${r.overdue} overdue · ${r.l3} L3 · ${r.dueSoon} due in 3 days · ${r.open} open` }));
  const top = adminDigest.l3.slice(0, 10).map((t) => ({ type: 'TextBlock', wrap: true, spacing: 'Small', text: `**${t.id}** ${t.program}: ${String(t.desc || '').slice(0, 100)} (${t.owner}, ${t.daysLate ?? '—'} days late)` }));
  const body = [
    { type: 'TextBlock', size: 'Large', weight: 'Bolder', text: `OPL morning update${todayLabel ? ` · ${todayLabel}` : ''}` },
    { type: 'TextBlock', wrap: true, text: `${adminDigest.overdue.length} overdue, ${adminDigest.l3.length} escalated to L3, ${adminDigest.dueSoon.length} due in the next 3 days, ${adminDigest.open} open in total.` },
    { type: 'FactSet', facts },
  ];
  if (top.length) body.push({ type: 'TextBlock', weight: 'Bolder', text: 'Most delayed (L3)', spacing: 'Medium' }, ...top);
  const card = { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body };
  if (appUrl) card.actions = [{ type: 'Action.OpenUrl', title: 'Open the app', url: appUrl }];
  return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', contentUrl: null, content: card }] };
}

module.exports = { scopeFor, digestFor, renderEmail, teamsCard, LIST_LIMIT };
