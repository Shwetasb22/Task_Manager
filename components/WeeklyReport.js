'use client';
import { useMemo, useState } from 'react';
import { FileDown } from 'lucide-react';
import { fmtDate, fmtShort } from '@/lib/rules';
import { recentWeekEnds, weeklyReport } from '@/lib/report';
import Logo from './Logo';

const LIST_LIMIT = 40;

// A one-week summary for the Monday review, laid out for A4. "Save as PDF" opens the browser's print
// window, where "Save as PDF" (or a PDF printer) gives a file to email or archive.
export default function WeeklyReport({ tasks, session, scopeLabel, today }) {
  const weeks = useMemo(() => recentWeekEnds(today), [today]);
  const [weekEnd, setWeekEnd] = useState(() => fmtDate(weeks[0]));
  const report = useMemo(() => weeklyReport(tasks, weeks.find((w) => fmtDate(w) === weekEnd) || weeks[0]), [tasks, weeks, weekEnd]);
  const isOwner = session.role === 'Owner';
  const { now, prev } = report;

  return (
    <div className="max-w-[1100px]">
      <div className="flex flex-wrap items-center gap-3 mb-4 print:hidden">
        <h1 className="text-[22px] font-semibold mr-auto">Weekly Report</h1>
        <label className="text-[12px] text-brembo-sub flex items-center gap-2">Week
          <select value={weekEnd} onChange={(e) => setWeekEnd(e.target.value)} aria-label="Week ending" className="bg-white border border-brembo-line rounded-md px-2 py-1.5 text-[12.5px] text-brembo-ink">
            {weeks.map((w, i) => {
              const v = fmtDate(w);
              return <option key={v} value={v}>{i === 0 ? `Last 7 days (to ${fmtShort(v)})` : `Week to ${fmtShort(v)}`}</option>;
            })}
          </select>
        </label>
        <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12.5px] font-bold bg-brembo-red text-white shadow-card">
          <FileDown size={14} /> Save as PDF
        </button>
      </div>
      <p className="text-[12px] text-brembo-sub mb-4 print:hidden">In the print window, choose &quot;Save as PDF&quot; as the printer. The report covers your current view, so pick a tracker in the menu first to report on one tracker only.</p>

      <article id="weekly-report" className="bg-white border border-brembo-line rounded-xl p-6 shadow-card print:border-0 print:shadow-none print:p-0 text-brembo-ink">
        <header className="border-t-4 border-brembo-red pt-3 flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex items-start gap-3">
            <Logo size={36} />
            <div>
            <div className="text-[12px]"><b className="text-brembo-red">Brembo India</b> · Program Command</div>
            <h2 className="text-[20px] font-semibold mt-1">Weekly OPL report</h2>
            <div className="text-[12.5px] text-brembo-sub">{scopeLabel}</div>
            </div>
          </div>
          <div className="text-right text-[12.5px]">
            <div><b>{fmtShort(report.from)} to {fmtShort(report.to)}</b></div>
            <div className="text-brembo-sub">Compared with the week before</div>
          </div>
        </header>

        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 mt-5" aria-label="Summary">
          <Kpi label="Open" value={now.open} prev={prev.open} />
          <Kpi label="Overdue" value={now.overdue} prev={prev.overdue} bad />
          <Kpi label="Escalated (L3)" value={now.l3} prev={prev.l3} bad />
          <Kpi label="No target date" value={now.gap} prev={prev.gap} bad />
          <Kpi label="Closed this week" value={now.closed} note={now.closed ? `${Math.round((now.onTime / now.closed) * 100)}% on time` : ''} />
          <Kpi label="Added this week" value={now.added} />
        </section>

        {!isOwner && report.byTracker.length > 1 && <GroupTable title="By tracker" rows={report.byTracker} />}
        {!isOwner && <GroupTable title="By department" rows={report.byDept} />}

        <IssueTable title="Overdue" rows={report.overdue} cols={['id', 'owner', 'program', 'desc', 'due', 'late']} />
        <IssueTable title="Closed this week" rows={report.closed} cols={['id', 'owner', 'program', 'desc', 'due', 'closed']} />
        <IssueTable title="Due next week" rows={report.dueNextWeek} cols={['id', 'owner', 'program', 'desc', 'due']} />
        <IssueTable title="Added this week" rows={report.added} cols={['id', 'owner', 'program', 'desc', 'due']} />
        <IssueTable title="No target date" rows={report.noDate} cols={['id', 'owner', 'program', 'desc']} />

        <footer className="mt-6 text-[10.5px] text-brembo-sub">
          Made {new Date().toLocaleString()} by {session.display || session.name}. Status follows the app rules: overdue means past the target date; L3 means more than 7 days late.
        </footer>
      </article>
    </div>
  );
}

function Kpi({ label, value, prev, bad, note }) {
  const diff = prev === undefined ? null : value - prev;
  const better = diff === null || diff === 0 || bad === undefined ? null : (bad ? diff < 0 : diff > 0);
  return (
    <div className="border border-brembo-line rounded-lg px-3 py-2.5 break-inside-avoid">
      <div className="text-[11px] text-brembo-sub">{label}</div>
      <div className="text-[22px] font-semibold leading-tight">{value}</div>
      {diff !== null && (
        <div className={`text-[11px] ${better === null ? 'text-brembo-sub' : better ? 'text-[#146b38]' : 'text-[#9b1224]'}`}>
          {diff === 0 ? 'same as last week' : `${diff > 0 ? '+' : ''}${diff} vs last week (${prev})`}
        </div>
      )}
      {note && <div className="text-[11px] text-brembo-sub">{note}</div>}
    </div>
  );
}

const th = 'text-left px-2 py-1.5 border-b-2 border-brembo-red text-[11px] text-brembo-sub font-semibold';
const td = 'px-2 py-1.5 border-b border-brembo-line align-top';

function GroupTable({ title, rows }) {
  return (
    <section className="mt-6">
      <h3 className="text-[14px] font-semibold mb-1.5">{title}</h3>
      <table className="w-full text-[12px] border-collapse">
        <thead><tr>{['Name', 'Open', 'Overdue', 'L3', 'Closed this week', 'On time'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="break-inside-avoid">
              <td className={td}>{r.name}</td>
              <td className={td}>{r.open}</td>
              <td className={`${td} ${r.overdue ? 'text-[#9b1224] font-semibold' : ''}`}>{r.overdue}</td>
              <td className={td}>{r.l3}</td>
              <td className={td}>{r.closed}</td>
              <td className={td}>{r.closed ? `${Math.round((r.onTime / r.closed) * 100)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const COLS = {
  id: { label: 'ID', value: (t) => t.id, nowrap: true },
  owner: { label: 'Owner', value: (t) => t.owner },
  program: { label: 'Program', value: (t) => t.program },
  desc: { label: 'Issue', value: (t) => (String(t.desc || '').length > 110 ? `${String(t.desc).slice(0, 108)}…` : t.desc), wide: true },
  due: { label: 'Target', value: (t) => fmtShort(t.due), nowrap: true },
  late: { label: 'Days late', value: (t) => t.daysLate, nowrap: true },
  closed: { label: 'Closed', value: (t) => `${fmtShort(t.closed)}${t.onTime ? '' : ' (late)'}`, nowrap: true },
};

function IssueTable({ title, rows, cols }) {
  return (
    <section className="mt-6">
      <h3 className="text-[14px] font-semibold mb-1.5">{title} <span className="text-brembo-sub font-normal">({rows.length})</span></h3>
      {rows.length === 0 ? <div className="text-[12px] text-brembo-sub">None.</div> : (
        <table className="w-full text-[12px] border-collapse">
          <thead><tr>{cols.map((c) => <th key={c} className={th}>{COLS[c].label}</th>)}</tr></thead>
          <tbody>
            {rows.slice(0, LIST_LIMIT).map((t) => (
              <tr key={t.id} className="break-inside-avoid">
                {cols.map((c) => <td key={c} className={`${td} ${COLS[c].nowrap ? 'whitespace-nowrap' : ''} ${COLS[c].wide ? 'w-[45%]' : ''}`}>{COLS[c].value(t)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rows.length > LIST_LIMIT && <div className="text-[11px] text-brembo-sub mt-1">and {rows.length - LIST_LIMIT} more in the Task Register.</div>}
    </section>
  );
}
