'use client';
import { useMemo, useState } from 'react';
import { BellRing, FlagTriangleRight, Sunrise } from 'lucide-react';
import { fmtShort, startOfToday } from '@/lib/rules';
import { RygbLegend, RygbPill, rowTone } from './rygb';
import { ESCALATION_LABELS, ESCALATION_TONES, countByLevel, escalationTarget, escalationsFor } from '@/lib/escalations';

const LEVEL_ORDER = ['L3 HOD', 'L2 Manager', 'L1 Owner'];

function EscalationBadge({ level }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${ESCALATION_TONES[level] || 'bg-[#ececee] text-[#4d4d55]'}`}>
      <FlagTriangleRight size={11} />{ESCALATION_LABELS[level] || level}
    </span>
  );
}

// The app supplies tasks sorted by the shared, editable Sr No field; changing it also changes other views.
export default function MorningUpdate({ tasks, session, onSetSerial, onOpenTask }) {
  const [onlyMine, setOnlyMine] = useState(false);
  const today = startOfToday();
  const dateLabel = fmtShort(`${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`);
  const { rows, overdue, dueSoon, gaps, perOwner } = useMemo(() => {
    const open = [];
    let overdue = 0; let dueSoon = 0; let gaps = 0;
    const counts = {};
    for (const task of tasks) {
      if (task.status === 'Closed') continue;
      open.push(task);
      if (task.status === 'Overdue') overdue += 1;
      else if (task.status === 'Open' && task.daysToDue >= 0 && task.daysToDue <= 3) dueSoon += 1;
      if (task.rgy === 'Grey') gaps += 1;
      const owner = task.owner || 'Unassigned';
      counts[owner] = (counts[owner] || 0) + 1;
    }
    const perOwner = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return { rows: open, overdue, dueSoon, gaps, perOwner };
  }, [tasks]);
  const escalationAlerts = useMemo(() => escalationsFor(rows, session), [rows, session]);
  const mineIds = useMemo(() => new Set(escalationAlerts.map((task) => task.id)), [escalationAlerts]);
  const levelCounts = useMemo(() => countByLevel(escalationAlerts), [escalationAlerts]);
  const visibleRows = onlyMine ? rows.filter((task) => mineIds.has(task.id)) : rows;

  return (
    <div className="animate-rise-in max-w-[1500px] mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-5">
        <div>
          <div className="flex items-center gap-2 text-brembo-red text-[11px] uppercase tracking-[.18em] font-bold mb-2"><Sunrise size={13} /> Daily update</div>
          <h1 className="font-display text-3xl font-bold mb-1">Daily issue status</h1>
          <p className="text-brembo-sub text-[13px]">{dateLabel} · {overdue} Overdue · {dueSoon} Due within 3 days · {gaps} No target date · <b className={escalationAlerts.length ? 'text-[#9b1224]' : ''}>{escalationAlerts.length} escalated to you</b></p>
          <p className="mt-1 text-[11px] text-brembo-sub">Edit Sr No to set the shared task order. The change is saved and synchronized with the Task Register and other views.</p>
          <RygbLegend className="mt-2" />
          <p className="mt-1 text-[11px] text-brembo-sub">Click an issue row to open it in the Task Register. Rows highlighted in red are escalated to you.</p>
        </div>
        {escalationAlerts.length > 0 && (
          <label className="inline-flex items-center gap-2 self-start md:self-end rounded-full border border-brembo-red/40 bg-white px-3 py-1.5 text-xs font-semibold text-[#9b1224] cursor-pointer">
            <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} className="accent-[#c8102e]" />
            Show only my escalations ({escalationAlerts.length})
          </label>
        )}
      </div>

      {escalationAlerts.length > 0 && (
        <section aria-label="Escalation notifications" className="mb-4 rounded-xl border-2 border-brembo-red bg-[#fff2f2] p-4 shadow-defined">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[#9b1224]">
              <BellRing size={18} className="animate-pulse" />
              <h2 className="text-sm font-bold">Escalations requiring your attention</h2>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {LEVEL_ORDER.filter((level) => levelCounts[level]).map((level) => (
                <span key={level} className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${ESCALATION_TONES[level]}`}>{ESCALATION_LABELS[level]}: {levelCounts[level]}</span>
              ))}
              <span className="rounded-full bg-brembo-ink px-2.5 py-1 text-[11px] font-bold text-white">{escalationAlerts.length} action{escalationAlerts.length === 1 ? '' : 's'}</span>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-2 lg:grid-cols-2">
            {escalationAlerts.map((task) => (
              <button key={task.id} type="button" onClick={() => onOpenTask?.(task.id)} className="rounded-lg border border-brembo-red/40 bg-white p-3 text-left hover:border-brembo-red hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brembo-red">
                <div className="flex flex-wrap items-center gap-2">
                  <EscalationBadge level={task.esc} />
                  <strong className="text-xs text-brembo-ink">{task.id} · {task.program || 'Unassigned program'}</strong>
                  <span className="ml-auto text-[10px] font-bold uppercase tracking-wide text-[#9b1224]">{task.daysLate ? `${task.daysLate} day(s) late` : task.daysToDue != null ? `Due in ${task.daysToDue} day(s)` : 'No target date'}</span>
                </div>
                <p className="mt-1 text-[11px] leading-5 text-brembo-sub">{task.desc} · Owner: {task.owner || 'Unassigned'} · Target: {fmtShort(task.due)} · Escalated to {escalationTarget(task)}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_220px] gap-4">
        <div className="glass-panel rounded-xl min-w-0">
          <div className="table-scroll overflow-x-auto">
            <table className="w-full min-w-[1120px] text-[12.5px] border-collapse">
              <thead>
                <tr className="bg-brembo-panel2/90 text-brembo-sub">
                  {['Sr No', 'Program', 'Activity to act on', 'Remarks', 'Owner', 'Target / Revised', 'Status', 'Escalation'].map((heading) => (
                    <th key={heading} className="text-left font-semibold px-2.5 py-2 whitespace-nowrap">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.length === 0 && <tr><td colSpan={8} className="px-3 py-4 text-brembo-sub">Nothing needs attention today.</td></tr>}
                {visibleRows.map((task) => {
                  const escalationForMe = mineIds.has(task.id);
                  const tone = escalationForMe ? 'bg-[#ffe1e5] outline outline-2 -outline-offset-2 outline-brembo-red/70' : rowTone(task);
                  return (
                    <tr key={task.id} data-task-id={task.id} tabIndex={onOpenTask ? 0 : undefined}
                      onClick={(event) => {
                        if (!onOpenTask || event.target.closest('button,input,select,textarea,a,label,[role="button"]')) return;
                        onOpenTask(task.id);
                      }}
                      onKeyDown={(event) => { if (onOpenTask && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpenTask(task.id); } }}
                      title={onOpenTask ? `Open ${task.id} in Task Register` : undefined}
                      aria-label={escalationForMe ? `${task.id} escalated to you (${ESCALATION_LABELS[task.esc]})` : undefined}
                      className={`border-t border-brembo-line align-top ${tone} ${onOpenTask ? 'cursor-pointer hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brembo-red' : ''}`}>
                      <td className={`px-2.5 py-2 whitespace-nowrap ${escalationForMe ? 'border-l-[6px] border-l-brembo-red font-bold' : ''}`}>
                        {onSetSerial ? <input key={`${task.id}-${task.srNo ?? ''}`} defaultValue={task.srNo ?? ''} onBlur={(event) => {
                          const next = event.target.value.trim();
                          if (next !== String(task.srNo ?? '')) onSetSerial(task.id, next || null);
                        }} aria-label={`Set order number for ${task.id}`} title="Editable shared order; saved across views" className="w-16 rounded border border-[#c8d3ca] bg-white px-1.5 py-1 text-center text-[11.5px]" /> : task.srNo || '—'}
                      </td>
                      <td className="px-2.5 py-2 whitespace-nowrap">{task.program || '—'}</td>
                      <td className="px-2.5 py-2 max-w-[360px] min-w-[280px] whitespace-normal break-words">{task.desc}</td>
                      <td className="px-2.5 py-2 max-w-[280px] min-w-[180px] whitespace-normal break-words text-brembo-sub">{task.remark || '—'}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap">{task.owner || 'Unassigned'}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap">{fmtShort(task.due)}{task.next ? ` | Revised: ${fmtShort(task.next)}` : ''}</td>
                      <td className="px-2.5 py-2 whitespace-nowrap"><RygbPill task={task} /></td>
                      <td className="px-2.5 py-2 whitespace-nowrap">
                        {ESCALATION_LABELS[task.esc] ? (
                          <div className="flex flex-col items-start gap-1">
                            <EscalationBadge level={task.esc} />
                            <span className="text-[10.5px] text-brembo-sub">{escalationTarget(task)}</span>
                            {escalationForMe && <span className="inline-flex rounded bg-brembo-red px-1.5 py-0.5 text-[9px] font-bold text-white">ACTION REQUIRED BY YOU</span>}
                          </div>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="glass-panel rounded-xl p-4 h-fit">
          <h3 className="text-brembo-ink text-[13px] font-semibold mb-2">Attention per owner</h3>
          {perOwner.length === 0 ? <div className="text-xs text-brembo-sub">—</div> : perOwner.map(([owner, count]) => (
            <div key={owner} className="flex justify-between text-xs py-1 border-b border-brembo-line last:border-0"><span>{owner}</span><b>{count}</b></div>
          ))}
        </div>
      </div>
    </div>
  );
}
