'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { CalendarClock, CalendarX2, CircleAlert, ClipboardList, FlagTriangleRight, MousePointerClick, RotateCcw, ShieldCheck, Timer, X } from 'lucide-react';
import { fmtDate } from '@/lib/data';
import { LEGACY_STATUS_LABELS, RYGB, RYGB_ORDER, getTaskStatusPresentation, startOfToday } from '@/lib/rules';
import {
  DIMENSIONS, crossFilter, getTopOverdueIssues, groupByDepartment, groupByDueDateAction, groupByEscalation,
  groupByOwner, groupByRgy, hasSelection, isSelected, toggleSelection,
} from '@/lib/dashboard/aggregations';
import { RYGB_SOLID, RygbLegend, RygbPill, rowTone } from './rygb';

const AXIS = { fill: '#635c5f', fontSize: 11 };
const GRID = '#eadfe2';
const DIMMED = 0.25;
const KPI_ICONS = { Red: CircleAlert, Yellow: Timer, Green: CalendarClock, Blue: ShieldCheck, Grey: CalendarX2 };
const SERIES = RYGB_ORDER.map((key) => ({ key, field: key.toLowerCase(), label: RYGB[key].label, color: RYGB[key].color }));
const additive = (event) => Boolean(event && (event.ctrlKey || event.metaKey || event.shiftKey));
const sameSet = (a = [], b = []) => a.length === b.length && a.every((v) => b.includes(v));

export default function Dashboard({ scopedTasks, filters, setFilters, loading = false, redFlagCount = 0, onOpenTask }) {
  // Click selections on the visuals (Power BI cross-filter), separate from the slicer dropdowns.
  const [selection, setSelection] = useState({});
  const [tableLimit, setTableLimit] = useState(25);

  const depts = useMemo(() => [...new Set(scopedTasks.map((task) => task.dept || 'Unassigned'))].sort(), [scopedTasks]);
  // Owner choices follow the chosen department: only people with issues in it.
  const owners = useMemo(() => [...new Set(scopedTasks
    .filter((task) => filters.dept === 'All' || (task.dept || 'Unassigned') === filters.dept)
    .map((task) => task.owner).filter(Boolean))].sort(), [scopedTasks, filters.dept]);
  useEffect(() => {
    if (filters.owner !== 'All' && !owners.includes(filters.owner)) setFilters((current) => ({ ...current, owner: 'All' }));
  }, [owners, filters.owner, setFilters]);
  const customers = useMemo(() => [...new Set(scopedTasks.map((task) => task.customer).filter(Boolean))].sort(), [scopedTasks]);
  const programs = useMemo(() => [...new Set(scopedTasks.map((task) => task.program).filter((program) => String(program || '').trim()))].sort(), [scopedTasks]);

  // Slicers (dropdowns) narrow the whole page first.
  const tasks = useMemo(() => {
    const status = LEGACY_STATUS_LABELS[filters.rgy] || filters.rgy;
    return scopedTasks.filter((task) => {
      if (!String(task.program || '').trim()) return false;
      if (filters.dept !== 'All' && (task.dept || 'Unassigned') !== filters.dept) return false;
      if (filters.owner !== 'All' && task.owner !== filters.owner) return false;
      if (filters.customer && filters.customer !== 'All' && task.customer !== filters.customer) return false;
      if (filters.program && filters.program !== 'All' && task.program !== filters.program) return false;
      if (status !== 'All' && getTaskStatusPresentation(task).label !== status) return false;
      if (filters.due !== 'All') {
        const diff = task.daysToDue;
        if (filters.due === 'Overdue') return task.status === 'Overdue';
        if (task.status === 'Closed' || diff === null || diff === undefined) return false;
        if (filters.due === 'This Week') return diff >= 0 && diff <= 7;
        if (filters.due === 'This Month') return diff >= 0 && diff <= 30;
      }
      return true;
    });
  }, [scopedTasks, filters]);

  // Each visual sees every click selection except its own, so it keeps its bars and highlights the chosen ones.
  const statusRows = useMemo(() => groupByRgy(crossFilter(tasks, selection, 'rygb')), [tasks, selection]);
  const latenessRows = useMemo(() => groupByDueDateAction(crossFilter(tasks, selection, 'lateness')), [tasks, selection]);
  const deptRows = useMemo(() => groupByDepartment(crossFilter(tasks, selection, 'dept')), [tasks, selection]);
  const ownerRows = useMemo(() => groupByOwner(crossFilter(tasks, selection, 'owner')), [tasks, selection]);
  const escRows = useMemo(() => groupByEscalation(crossFilter(tasks, selection, 'esc')), [tasks, selection]);
  const selectedTasks = useMemo(() => crossFilter(tasks, selection), [tasks, selection]);
  const overdueIssues = useMemo(() => getTopOverdueIssues(selectedTasks), [selectedTasks]);
  useEffect(() => { setTableLimit(25); }, [selection, filters]);

  const statusTotal = statusRows.reduce((sum, row) => sum + row.value, 0);
  const latenessTotal = latenessRows.reduce((sum, row) => sum + row.value, 0);
  const anySelection = Object.keys(selection).length > 0;

  const pick = (dim, values, event) => setSelection((current) => toggleSelection(current, dim, values, additive(event)));
  // A stacked segment is the intersection of a category and a status colour (Power BI behaviour).
  const pickSegment = (dim, members, colour, event) => setSelection((current) => {
    if (additive(event)) return toggleSelection(toggleSelection(current, dim, members, true), 'rygb', [colour], true);
    if (sameSet(current[dim], members) && sameSet(current.rygb, [colour])) {
      const next = { ...current };
      delete next[dim];
      delete next.rygb;
      return next;
    }
    return { ...current, [dim]: members, rygb: [colour] };
  });
  const opacity = (dim, values) => (!hasSelection(selection, dim) || values.some((v) => isSelected(selection, dim, v)) ? 1 : DIMMED);
  const segmentOpacity = (dim, members, colour) => Math.min(opacity(dim, members), opacity('rygb', [colour]));
  const clearDimension = (dim) => setSelection((current) => { const next = { ...current }; delete next[dim]; return next; });

  function resetAll() {
    setSelection({});
    setFilters({ dept: 'All', owner: 'All', customer: 'All', program: 'All', rgy: 'All', due: 'All' });
  }

  return (
    <div className="animate-rise-in max-w-[1500px] mx-auto space-y-5">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight mb-1 text-brembo-ink">Task Manager</h1>
          <p className="text-brembo-sub text-[13px]">A current view of program issues, due dates, and escalation.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-brembo-sub">
          <span className="bg-white border border-brembo-line rounded-full px-3 py-2 shadow-card">As of {fmtDate(startOfToday())} · {tasks.length} issues</span>
          <span className="inline-flex items-center gap-1.5 bg-[#fff0f0] border border-brembo-red/30 text-[#9b1224] rounded-full px-3 py-2 font-bold shadow-card" title="Count across all trackers, independent of dashboard filters"><FlagTriangleRight size={13} /> System red flags: {redFlagCount}</span>
        </div>
      </header>

      <RygbLegend className="glass-panel rounded-xl px-4 py-2.5" />

      <section aria-label="Dashboard filters" className="flex flex-wrap items-center gap-2">
        <Select value={filters.dept} onChange={(value) => setFilters((current) => ({ ...current, dept: value }))} label="Department" options={depts} />
        <Select value={filters.owner} onChange={(value) => setFilters((current) => ({ ...current, owner: value }))} label="Owner" options={owners} />
        <Select value={filters.customer || 'All'} onChange={(value) => setFilters((current) => ({ ...current, customer: value }))} label="Customer" options={customers} />
        <Select value={filters.program || 'All'} onChange={(value) => setFilters((current) => ({ ...current, program: value }))} label="Program" options={programs} />
        <Select value={LEGACY_STATUS_LABELS[filters.rgy] || filters.rgy} onChange={(value) => setFilters((current) => ({ ...current, rgy: value }))} label="Status" options={RYGB_ORDER.map((key) => RYGB[key].label)} />
        <Select value={filters.due} onChange={(value) => setFilters((current) => ({ ...current, due: value }))} label="Due" options={['This Week', 'This Month', 'Overdue']} />
        <button type="button" onClick={resetAll} className="inline-flex items-center gap-2 border border-brembo-line bg-white rounded-full px-3 py-2 text-[11px] text-brembo-sub hover:text-brembo-ink hover:border-brembo-red shadow-card">
          <RotateCcw size={12} /> Reset
        </button>
      </section>

      <section aria-label="Selections" className="flex flex-wrap items-center gap-2 min-h-[32px] text-[11.5px]">
        {anySelection ? (
          <>
            <span className="text-brembo-sub font-semibold">Filtered by your clicks:</span>
            {Object.entries(selection).map(([dim, values]) => (
              <button key={dim} type="button" onClick={() => clearDimension(dim)} aria-label={`Remove ${DIMENSIONS[dim].label} selection`}
                className="inline-flex items-center gap-1.5 rounded-full border border-brembo-red/40 bg-white px-2.5 py-1 font-semibold text-brembo-ink hover:border-brembo-red">
                {DIMENSIONS[dim].label}: {values.map(DIMENSIONS[dim].name).join(', ')} <X size={12} />
              </button>
            ))}
            <button type="button" onClick={() => setSelection({})} className="rounded-full bg-brembo-ink px-3 py-1 font-bold text-white hover:bg-black">Clear all selections</button>
            <span className="text-brembo-sub">{selectedTasks.length} issue{selectedTasks.length === 1 ? '' : 's'} selected</span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-brembo-sub"><MousePointerClick size={13} /> Click any card, slice or bar to filter every visual. Ctrl/Shift-click to pick several; click again to clear.</span>
        )}
      </section>

      <section aria-label="Issue summary" className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard label="Total" sub="All colours" value={statusTotal} total={statusTotal} Icon={ClipboardList} className="bg-white text-brembo-ink"
          pressed={!hasSelection(selection, 'rygb')} dimmed={false} onClick={() => clearDimension('rygb')} />
        {statusRows.map((row) => (
          <KpiCard key={row.name} label={row.label} sub={RYGB[row.name].rule} value={row.value} total={statusTotal} Icon={KPI_ICONS[row.name]}
            className={RYGB_SOLID[row.name]} pressed={isSelected(selection, 'rygb', row.name)}
            dimmed={hasSelection(selection, 'rygb') && !isSelected(selection, 'rygb', row.name)}
            onClick={(event) => pick('rygb', [row.name], event)} />
        ))}
      </section>

      <section aria-label="Overall status and lateness" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Overall issue status" subtitle="Click a slice or a legend row to filter every visual">
          {loading ? <ChartSkeleton /> : statusTotal === 0 ? <EmptyChart message="No issues match the current view." /> : (
            <div className="grid grid-cols-1 sm:grid-cols-[minmax(160px,1fr)_minmax(150px,1fr)] items-center gap-2 min-h-[280px]">
              <div className="relative h-[260px] min-h-[240px]" aria-label={`Status distribution, ${statusTotal} issues`}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusRows} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="82%" paddingAngle={2} stroke="none"
                      onClick={(_, index, event) => pick('rygb', [statusRows[index].name], event)} isAnimationActive={false}>
                      {statusRows.map((row) => <Cell key={row.name} fill={row.color} fillOpacity={opacity('rygb', [row.name])} cursor="pointer" />)}
                    </Pie>
                    <Tooltip content={<DonutTooltip total={statusTotal} />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <strong className="text-2xl text-brembo-ink">{statusTotal}</strong>
                  <span className="text-[10px] text-brembo-sub">issues</span>
                </div>
              </div>
              <div className="space-y-1">
                {statusRows.map((row) => (
                  <LegendButton key={row.name} name={row.label} value={row.value} total={statusTotal} color={row.color}
                    pressed={isSelected(selection, 'rygb', row.name)} dimmed={opacity('rygb', [row.name]) < 1}
                    onClick={(event) => pick('rygb', [row.name], event)} />
                ))}
              </div>
            </div>
          )}
        </ChartCard>

        <ChartCard title="How late is open work" subtitle="Open issues by days past (or before) the target date · click a bar">
          {loading ? <ChartSkeleton /> : latenessTotal === 0 ? <EmptyChart message="No open issues match the current view." /> : (
            <div className="h-[280px] min-h-[260px]" aria-label={`Bar chart of ${latenessTotal} open issues by lateness`}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={latenessRows} layout="vertical" margin={{ top: 4, right: 36, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={AXIS} />
                  <YAxis type="category" dataKey="label" width={140} tick={AXIS} />
                  <Tooltip cursor={{ fill: 'rgba(28, 20, 24, 0.05)' }} content={<LatenessTooltip total={latenessTotal} />} />
                  <Bar dataKey="value" name="Open issues" maxBarSize={26} radius={[0, 6, 6, 0]} isAnimationActive={false}
                    label={{ position: 'right', fill: '#2b2427', fontSize: 11 }}
                    onClick={(_, index, event) => pick('lateness', [latenessRows[index].key], event)}>
                    {latenessRows.map((row) => <Cell key={row.key} fill={row.color} fillOpacity={opacity('lateness', [row.key])} cursor="pointer" />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>
      </section>

      <section aria-label="Department status and escalation" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Status by department" subtitle="Click a coloured segment for that department and status, or a key to filter by status">
          {loading ? <ChartSkeleton /> : deptRows.length === 0 ? <EmptyChart message="No department data in this view." /> : (
            <>
              <SeriesKey selection={selection} onPick={pick} />
              <div className="h-[320px] min-h-[280px]" aria-label="Stacked bar chart of status by department">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={deptRows} margin={{ top: 8, right: 8, left: 0, bottom: 28 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                    <XAxis dataKey="department" tick={AXIS} interval={0} angle={-24} textAnchor="end" height={56} />
                    <YAxis allowDecimals={false} tick={AXIS} />
                    <Tooltip cursor={{ fill: 'rgba(28, 20, 24, 0.05)' }} content={<StackedTooltip />} />
                    {SERIES.map((s) => (
                      <Bar key={s.key} dataKey={s.field} name={s.label} stackId="rygb" fill={s.color} maxBarSize={42} isAnimationActive={false}
                        onClick={(_, index, event) => pickSegment('dept', deptRows[index].members, s.key, event)}>
                        {deptRows.map((row) => <Cell key={row.department} fillOpacity={segmentOpacity('dept', row.members, s.key)} cursor="pointer" />)}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </ChartCard>

        <ChartCard title="Escalation level" subtitle="Open issues by who is notified (colour follows the level's status) · click a bar">
          {loading ? <ChartSkeleton /> : escRows.every((row) => row.issues === 0) ? <EmptyChart message="No open issues match the current view." /> : (
            <div className="h-[340px] min-h-[300px]" aria-label="Bar chart of open issues by escalation level">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={escRows} layout="vertical" margin={{ top: 8, right: 36, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={AXIS} />
                  <YAxis type="category" dataKey="level" width={104} tick={AXIS} />
                  <Tooltip cursor={{ fill: 'rgba(28, 20, 24, 0.05)' }} content={<EscalationTooltip />} />
                  <Bar dataKey="issues" name="Open issues" maxBarSize={28} radius={[0, 6, 6, 0]} isAnimationActive={false}
                    label={{ position: 'right', fill: '#2b2427', fontSize: 11 }}
                    onClick={(_, index, event) => pick('esc', [escRows[index].level], event)}>
                    {escRows.map((row) => <Cell key={row.level} fill={row.color} fillOpacity={opacity('esc', [row.level])} cursor="pointer" />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>
      </section>

      <section aria-label="Owners and overdue issues" className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Status by owner" subtitle="Owners with the most overdue work first · click a segment">
          {loading ? <ChartSkeleton /> : ownerRows.length === 0 ? <EmptyChart message="No owners in this view." /> : (
            <>
              <SeriesKey selection={selection} onPick={pick} />
              <div style={{ height: Math.max(260, ownerRows.length * 30 + 40) }} aria-label="Stacked bar chart of status by owner">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ownerRows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={AXIS} />
                    <YAxis type="category" dataKey="owner" width={150} tick={AXIS} interval={0} />
                    <Tooltip cursor={{ fill: 'rgba(28, 20, 24, 0.05)' }} content={<StackedTooltip />} />
                    {SERIES.map((s) => (
                      <Bar key={s.key} dataKey={s.field} name={s.label} stackId="rygb" fill={s.color} maxBarSize={22} isAnimationActive={false}
                        onClick={(_, index, event) => pickSegment('owner', ownerRows[index].members, s.key, event)}>
                        {ownerRows.map((row) => <Cell key={row.owner} fillOpacity={segmentOpacity('owner', row.members, s.key)} cursor="pointer" />)}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </ChartCard>

        <article className="glass-panel rounded-xl border border-brembo-red/40 border-l-4 border-l-brembo-red p-4 min-w-0">
          <div className="mb-3"><h2 className="text-brembo-ink text-sm font-semibold">Top 10 most overdue issues</h2><p className="text-[11px] text-brembo-sub mt-1">Follows your selections · click a row to open the issue</p></div>
          {loading ? <ChartSkeleton /> : overdueIssues.length === 0 ? <EmptyChart message="No overdue issues in this selection." /> : (
            <IssueTable tasks={overdueIssues} onOpenTask={onOpenTask} columns={['Issue', 'Owner', 'Department', 'Days overdue', 'Escalation']} compact />
          )}
        </article>
      </section>

      <section aria-label="Issues in this selection" className="glass-panel rounded-xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-brembo-line">
          <div>
            <h2 className="text-brembo-ink text-sm font-semibold">Issues in this selection</h2>
            <p className="text-brembo-sub text-xs mt-1">{selectedTasks.length} issue{selectedTasks.length === 1 ? '' : 's'} · rows are coloured by status · click a row to open it in the Task Register</p>
          </div>
        </div>
        {selectedTasks.length === 0 ? <div className="p-4 text-sm text-brembo-sub">No issues match the current selection.</div> : (
          <IssueTable tasks={selectedTasks.slice(0, tableLimit)} onOpenTask={onOpenTask} columns={['Issue', 'Status', 'Program', 'Description', 'Department', 'Owner', 'Target date', 'Escalation']} />
        )}
        {selectedTasks.length > tableLimit && (
          <div className="px-4 py-3 border-t border-brembo-line text-xs text-brembo-sub flex items-center justify-between gap-3">
            <span>Showing {tableLimit} of {selectedTasks.length}.</span>
            <button type="button" onClick={() => setTableLimit((n) => n + 50)} className="border border-brembo-line rounded-full px-3 py-1 bg-white hover:border-brembo-red text-brembo-ink font-semibold">Show 50 more</button>
          </div>
        )}
      </section>
    </div>
  );
}

function KpiCard({ label, sub, value, total, Icon, className, pressed, dimmed, onClick }) {
  const percentage = total ? Math.round((value / total) * 100) : 0;
  return (
    <button type="button" onClick={onClick} aria-pressed={pressed} aria-label={`${label}: ${value} issues, ${percentage}%. Click to filter.`}
      className={`rounded-xl border border-brembo-line p-3.5 min-h-[112px] text-left shadow-defined transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brembo-ink hover:-translate-y-0.5 ${className} ${pressed ? 'ring-[3px] ring-brembo-ink' : ''} ${dimmed ? 'opacity-35 hover:opacity-70' : ''}`}>
      <Icon size={17} aria-hidden="true" className="float-right opacity-80" />
      <div className="font-display text-3xl font-bold">{value}</div>
      <div className="text-sm font-semibold mt-1">{label}</div>
      <div className="text-[10.5px] mt-0.5 opacity-80">{percentage}% · {sub}</div>
    </button>
  );
}

function LegendButton({ name, value, total, color, pressed, dimmed, onClick }) {
  const percentage = total ? Math.round((value / total) * 100) : 0;
  return (
    <button type="button" onClick={onClick} aria-pressed={pressed} aria-label={`${name}: ${value} issues, ${percentage}%. Click to filter.`}
      className={`w-full flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-xs hover:bg-brembo-panel2 ${pressed ? 'bg-brembo-panel2 ring-1 ring-brembo-ink/40' : ''} ${dimmed ? 'opacity-40' : ''}`}>
      <span className="flex items-center gap-2 text-brembo-sub"><span className="h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />{name}</span>
      <b className="text-brembo-ink">{value} <span className="font-normal text-brembo-sub">· {percentage}%</span></b>
    </button>
  );
}

// Clickable colour key above stacked charts: filters every visual by that status.
function SeriesKey({ selection, onPick }) {
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {SERIES.map((s) => {
        const pressed = isSelected(selection, 'rygb', s.key);
        const dimmed = hasSelection(selection, 'rygb') && !pressed;
        return (
          <button key={s.key} type="button" onClick={(event) => onPick('rygb', [s.key], event)} aria-pressed={pressed}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${pressed ? 'border-brembo-ink font-bold' : 'border-brembo-line'} ${dimmed ? 'opacity-40' : ''} bg-white hover:border-brembo-ink`}>
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.color }} />{s.label}
          </button>
        );
      })}
    </div>
  );
}

function IssueTable({ tasks, columns, onOpenTask, compact = false }) {
  const cell = {
    Issue: (t) => <b className="text-brembo-ink">{t.id}</b>,
    Status: (t) => <RygbPill task={t} />,
    Program: (t) => t.program,
    Description: (t) => <span className="block max-w-[420px] whitespace-normal break-words">{t.desc}</span>,
    Department: (t) => t.dept || 'Unassigned',
    Owner: (t) => t.owner || '—',
    'Target date': (t) => t.due || '—',
    'Days overdue': (t) => <b className="text-[#9b1224]">{t.daysLate}</b>,
    Escalation: (t) => (t.esc && t.esc !== 'None' ? t.esc : '—'),
  };
  return (
    <div className={`table-scroll overflow-x-auto ${compact ? 'max-h-[340px]' : ''}`}>
      <table className={`w-full text-xs text-left ${compact ? 'min-w-[560px]' : 'min-w-[1100px]'}`}>
        <thead className="sticky top-0 bg-brembo-panel2 text-brembo-sub">
          <tr>{columns.map((heading) => <th key={heading} className="px-2.5 py-2 whitespace-nowrap">{heading}</th>)}</tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} data-task-id={task.id} tabIndex={onOpenTask ? 0 : undefined}
              onClick={() => onOpenTask?.(task.id)}
              onKeyDown={(event) => { if (onOpenTask && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpenTask(task.id); } }}
              title={onOpenTask ? `Open ${task.id} in Task Register` : undefined}
              className={`border-t border-brembo-line align-top ${rowTone(task)} ${onOpenTask ? 'cursor-pointer hover:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brembo-red' : ''}`}>
              {columns.map((heading) => <td key={heading} className={`px-2.5 py-2 ${heading === 'Description' ? '' : 'whitespace-nowrap'}`}>{cell[heading](task)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartCard({ title, subtitle, children }) {
  return (
    <article className="glass-panel rounded-xl p-4 min-w-0">
      <div className="mb-3">
        <h2 className="text-brembo-ink text-sm font-semibold">{title}</h2>
        <p className="text-[11px] text-brembo-sub mt-1">{subtitle}</p>
      </div>
      {children}
    </article>
  );
}

function ChartSkeleton() {
  return <div className="h-[300px] min-h-[260px] animate-pulse rounded-lg bg-brembo-panel2 border border-brembo-line" role="status" aria-label="Loading chart" />;
}

function EmptyChart({ message }) {
  return <div className="h-[260px] flex items-center justify-center text-center text-sm text-brembo-sub border border-dashed border-brembo-line rounded-lg bg-brembo-panel2">{message}</div>;
}

function ChartTooltipShell({ children }) {
  return <div role="tooltip" className="rounded-lg border border-brembo-line bg-white px-3 py-2 text-xs text-brembo-ink shadow-defined">{children}</div>;
}

function DonutTooltip({ active, payload, total }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const percentage = total ? Math.round((row.value / total) * 100) : 0;
  return <ChartTooltipShell><b>{row.label}</b>: {row.value} · {percentage}%<div className="text-brembo-sub">{RYGB[row.name].rule} · click to filter</div></ChartTooltipShell>;
}

function StackedTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <ChartTooltipShell>
      <div className="font-semibold mb-1">{label}</div>
      {payload.filter((entry) => entry.value).map((entry) => (
        <div key={entry.dataKey} className="flex justify-between gap-4">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: entry.color }} />{entry.name}</span>
          <b>{entry.value}</b>
        </div>
      ))}
      <div className="text-brembo-sub mt-1">Click a segment to filter</div>
    </ChartTooltipShell>
  );
}

function LatenessTooltip({ active, payload, total }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const percentage = total ? Math.round((row.value / total) * 100) : 0;
  return (
    <ChartTooltipShell>
      <div className="font-semibold">{row.label}: {row.value} issue{row.value === 1 ? '' : 's'} · {percentage}%</div>
      <div className="text-brembo-sub mt-1">{RYGB[row.tone].label} · next step: {row.action}</div>
    </ChartTooltipShell>
  );
}

function EscalationTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <ChartTooltipShell>
      <div className="font-semibold">{row.level === 'Neutral' ? 'No escalation' : row.level}</div>
      <div>Notify {row.role}: {row.issues} open issue{row.issues === 1 ? '' : 's'}</div>
      <div className="text-brembo-sub mt-1">{row.rule}</div>
    </ChartTooltipShell>
  );
}

function Select({ value, onChange, label, options }) {
  return (
    <select
      aria-label={`Filter by ${label.toLowerCase()}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="min-w-[130px] flex-1 bg-white border border-brembo-line text-[12px] text-brembo-ink rounded-full px-3 py-2 shadow-card"
    >
      <option value="All">{label}: All</option>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  );
}
