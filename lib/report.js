// Weekly report: where things stand at the end of a week, what changed during it, and the same
// numbers one week earlier for comparison. Uses the app's rules (lib/rules.js), so a report for the
// current week matches the Dashboard and Task Register.
const { deriveTask, parseDate, fmtDate, fmtShort } = require('./rules.js');

const DAY = 86400000;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const day = (value) => (value ? parseDate(String(value).slice(0, 10)) : null);

// The issue existed on date d: its start date (real tracker data) or, without one, when it was added.
function existedOn(t, d) {
  const since = day(t.start) || day(t.createdAt);
  return !since || since <= d;
}

// Every issue as it stood at the end of date d (closures after d are undone).
function snapshot(rawTasks, d) {
  return rawTasks
    .filter((t) => existedOn(t, d))
    .map((t) => deriveTask({ ...t, closed: t.closed && day(t.closed) <= d ? t.closed : null }, d));
}

function counts(tasks) {
  const open = tasks.filter((t) => t.status !== 'Closed');
  return {
    open: open.length,
    overdue: open.filter((t) => t.status === 'Overdue').length,
    l3: open.filter((t) => t.esc === 'L3 HOD').length,
    gap: open.filter((t) => t.rgy === 'Grey').length,
  };
}

const inRange = (value, from, to) => {
  const d = day(value);
  return Boolean(d) && d >= from && d <= to;
};
const byLateness = (a, b) => (b.daysLate || 0) - (a.daysLate || 0) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
const byId = (a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true });

function groupRows(key, endTasks, closed) {
  const rows = {};
  const row = (name) => rows[name] || (rows[name] = { name, open: 0, overdue: 0, l3: 0, closed: 0, onTime: 0 });
  endTasks.filter((t) => t.status !== 'Closed').forEach((t) => {
    const r = row(t[key] || 'Unassigned');
    r.open += 1;
    if (t.status === 'Overdue') r.overdue += 1;
    if (t.esc === 'L3 HOD') r.l3 += 1;
  });
  closed.forEach((t) => {
    const r = row(t[key] || 'Unassigned');
    r.closed += 1;
    if (t.onTime) r.onTime += 1;
  });
  return Object.values(rows).sort((a, b) => b.overdue - a.overdue || b.open - a.open || a.name.localeCompare(b.name));
}

/**
 * @param {object[]} rawTasks issues with the app's field names (due, closed, start, createdAt, ...)
 * @param {Date} weekEnd last day of the week (local date)
 */
function weeklyReport(rawTasks, weekEnd) {
  const to = new Date(weekEnd.getFullYear(), weekEnd.getMonth(), weekEnd.getDate());
  const from = addDays(to, -6);
  const end = snapshot(rawTasks, to);
  const before = snapshot(rawTasks, addDays(to, -7));
  const closed = end
    .filter((t) => inRange(t.closed, from, to))
    .map((t) => ({ ...t, onTime: !t.due || day(t.closed) <= day(t.due) }))
    .sort((a, b) => String(b.closed).localeCompare(String(a.closed)) || byId(a, b));
  const added = end.filter((t) => inRange(t.start || t.createdAt, from, to)).sort(byId);
  const open = end.filter((t) => t.status !== 'Closed');
  const nextWeekEnd = addDays(to, 7);
  return {
    from: fmtDate(from),
    to: fmtDate(to),
    now: { ...counts(end), closed: closed.length, added: added.length, onTime: closed.filter((t) => t.onTime).length },
    prev: counts(before),
    closed,
    added,
    overdue: open.filter((t) => t.status === 'Overdue').sort(byLateness),
    dueNextWeek: open.filter((t) => t.due && day(t.due) > to && day(t.due) <= nextWeekEnd).sort((a, b) => String(a.due).localeCompare(String(b.due)) || byId(a, b)),
    noDate: open.filter((t) => t.rgy === 'Grey').sort(byId),
    byTracker: groupRows('manager', end, closed),
    byDept: groupRows('dept', end, closed),
  };
}

// Week endings offered in the picker: the most recent Saturday-or-today first, then earlier weeks.
function recentWeekEnds(today, n = 8) {
  const out = [new Date(today.getFullYear(), today.getMonth(), today.getDate())];
  for (let i = 1; i < n; i += 1) out.push(addDays(out[0], -7 * i));
  return out;
}

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const EMAIL_LIMIT = 25;
const cell = 'padding:5px 8px;border-bottom:1px solid #eee;font-size:12.5px;vertical-align:top';
const head = 'text-align:left;padding:5px 8px;border-bottom:2px solid #c8102e;font-size:11.5px;color:#555';
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

// The same report as an email (Monday morning, see scripts/daily-digest.mjs --weekly).
function renderReportEmail(report, { scopeLabel = '', appUrl = '', showTrackers = true } = {}) {
  const { now, prev } = report;
  const delta = (a, b) => (a === b ? 'same' : `${a > b ? '+' : ''}${a - b}`);
  const kpis = [
    ['Open', now.open, delta(now.open, prev.open)], ['Overdue', now.overdue, delta(now.overdue, prev.overdue)],
    ['Escalated (L3)', now.l3, delta(now.l3, prev.l3)], ['No target date', now.gap, delta(now.gap, prev.gap)],
    ['Closed this week', now.closed, `${pct(now.onTime, now.closed)} on time`], ['Added this week', now.added, ''],
  ].map(([l, v, d]) => `<td style="border:1px solid #e3dadc;border-radius:6px;padding:8px 10px;width:16%"><div style="font-size:11px;color:#666">${esc(l)}</div><div style="font-size:20px;font-weight:bold">${v}</div><div style="font-size:11px;color:#777">${esc(d)}${d && !/on time/.test(d) ? ' vs last week' : ''}</div></td>`).join('');
  const group = (title, rows) => (rows.length ? `<h3 style="font-size:14px;margin:20px 0 6px">${esc(title)}</h3><table style="border-collapse:collapse;width:100%"><tr>${['Name', 'Open', 'Overdue', 'L3', 'Closed this week', 'On time'].map((h) => `<th style="${head}">${h}</th>`).join('')}</tr>${rows.map((r) => `<tr><td style="${cell}">${esc(r.name)}</td><td style="${cell}">${r.open}</td><td style="${cell};color:${r.overdue ? '#9b1224' : '#333'}">${r.overdue}</td><td style="${cell}">${r.l3}</td><td style="${cell}">${r.closed}</td><td style="${cell}">${pct(r.onTime, r.closed)}</td></tr>`).join('')}</table>` : '');
  const list = (title, rows, extra) => (rows.length ? `<h3 style="font-size:14px;margin:20px 0 6px">${esc(title)} (${rows.length})</h3><table style="border-collapse:collapse;width:100%"><tr>${['ID', 'Owner', 'Program', 'Issue', 'Target', extra.label].map((h) => `<th style="${head}">${esc(h)}</th>`).join('')}</tr>${rows.slice(0, EMAIL_LIMIT).map((t) => `<tr><td style="${cell};white-space:nowrap">${esc(t.id)}</td><td style="${cell}">${esc(t.owner)}</td><td style="${cell}">${esc(t.program)}</td><td style="${cell}">${esc(String(t.desc || '').slice(0, 100))}</td><td style="${cell};white-space:nowrap">${esc(fmtShort(t.due))}</td><td style="${cell};white-space:nowrap">${esc(extra.value(t))}</td></tr>`).join('')}</table>${rows.length > EMAIL_LIMIT ? `<p style="font-size:11.5px;color:#777;margin:4px 0 0">and ${rows.length - EMAIL_LIMIT} more in the app.</p>` : ''}` : '');
  const period = `${fmtShort(report.from)} to ${fmtShort(report.to)}`;
  const logo = appUrl ? `<img src="${esc(`${appUrl.replace(/\/+$/, '')}/logo.png`)}" alt="BYBRE logo" width="36" height="36" style="vertical-align:middle;margin-right:8px">` : '';
  const html = `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;color:#1c1418;max-width:960px;margin:0 auto;padding:16px">
<div style="border-top:4px solid #c8102e;padding-top:10px">${logo}<b style="color:#c8102e">Brembo India</b> · Program Command</div>
<h2 style="font-size:20px;margin:12px 0 2px">Weekly OPL report</h2>
<div style="font-size:13px;color:#555">${esc(scopeLabel)} · ${esc(period)}</div>
${appUrl ? `<p style="margin:12px 0"><a href="${esc(appUrl)}" style="background:#c8102e;color:#fff;text-decoration:none;padding:7px 14px;border-radius:16px;font-size:13px;font-weight:bold">Open the Weekly Report in the app</a></p>` : ''}
<table style="border-collapse:separate;border-spacing:6px;width:100%;margin-top:8px"><tr>${kpis}</tr></table>
${showTrackers && report.byTracker.length > 1 ? group('By tracker', report.byTracker) : ''}
${group('By department', report.byDept)}
${list('Overdue', report.overdue, { label: 'Days late', value: (t) => t.daysLate })}
${list('Closed this week', report.closed, { label: 'Closed', value: (t) => `${fmtShort(t.closed)}${t.onTime ? '' : ' (late)'}` })}
${list('Due next week', report.dueNextWeek, { label: 'Next date', value: (t) => fmtShort(t.next) })}
<p style="font-size:11px;color:#888;margin-top:24px">Sent every Monday. To stop it, switch off "Morning email" at the bottom of the menu in the app.</p>
</body></html>`;
  return { subject: `OPL weekly report ${period}: ${now.overdue} overdue, ${now.closed} closed`, html };
}

module.exports = { weeklyReport, snapshot, recentWeekEnds, renderReportEmail, DAY };
