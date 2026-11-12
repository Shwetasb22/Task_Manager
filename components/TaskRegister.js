'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, BookmarkPlus, Check, ChevronLeft, ChevronRight, Download, Eye, FileSpreadsheet, FlagTriangleRight, History, Paperclip, Pencil, Plus, RotateCcw, Upload, X } from 'lucide-react';
import { ACCEPT, canRemoveProof } from '@/lib/proofs';
import { fmtDate, getTaskRowTone, getTaskStatusPresentation, startOfToday } from '@/lib/rules';
import { downloadXlsx, taskExportRows, TASK_EXPORT_DATE_COLUMNS, TASK_EXPORT_HEADERS, TASK_EXPORT_WRAP_COLUMNS } from '@/lib/export';
import { DEFAULT_DEPARTMENTS } from '@/lib/issues';
import { isOwnerOf } from '@/lib/owners';
import { RYGB_PILL, RYGB_ROW } from './rygb';
import { dueAcceptanceOf } from '@/lib/due-policy';
import OwnerPicker from './OwnerPicker';
import BulkBar from './BulkBar';
import { QUICK_VIEWS, cleanView, countQuickViews, describeView, filterTasks } from '@/lib/views';

const TRACKER_COLUMNS = [
  'Sr No', 'Customer', 'Program Name', 'Issue Description', 'Dept', 'Owner',
  'Start Date', 'Target Date', 'Next Date', 'Actual Close Date', 'Days Pending',
  'Status', 'RGY', 'Remarks', 'Escalation Level',
];

export default function TaskRegister({ tasks, session, managers = [], departments: departmentList = null, employees = [], today: todayProp, savedViews = [], onSaveView, onDeleteView, onAddIssue, onImportExcel, onDeleteMany, onEditTask, onPatchTask, onBulkApply, onBulkClose, onBulkReopen, onShowHistory, showArchived = false, archivedCount = 0, onToggleArchived, onAddProof, onRemoveProof, onSetRemark, onSetDue, onSetNextDate, onSetDueAcceptance, onSetOwner, onToggleRedFlag, onClose, onReopen, onViewProof, closedOnly = false, onShowClosedIssues, onShowActiveRegister, navigationRequest = null, onNavigationHandled }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(closedOnly ? 'Closed' : 'Active');
  const [quick, setQuick] = useState('all');
  const [columnFilters, setColumnFilters] = useState({});
  const [naming, setNaming] = useState(null); // name typed for a new saved view, or null when closed
  // The table is taller than the screen, so its own sideways scrollbar sits out of sight below the
  // last row. A second scrollbar pinned to the bottom of the screen mirrors it instead.
  const sheetRef = useRef(null);
  const sliderRef = useRef(null);
  const [slider, setSlider] = useState({ width: 0, show: false });
  useEffect(() => {
    const box = sheetRef.current;
    if (!box) return undefined;
    const measure = () => setSlider((cur) => {
      const next = { width: box.scrollWidth, show: box.scrollWidth > box.clientWidth + 1 };
      return cur.width === next.width && cur.show === next.show ? cur : next;
    });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    if (box.firstElementChild) observer.observe(box.firstElementChild);
    return () => observer.disconnect();
  }, []);
  // Moving one bar moves the other, and that move reports back as a scroll of its own. Without
  // skipping that echo the two bars correct each other on every frame and the slider stutters.
  const echoRef = useRef(null);
  const syncScroll = (from, to) => {
    if (!from || !to) return;
    if (echoRef.current === from) { echoRef.current = null; return; }
    const before = to.scrollLeft;
    to.scrollLeft = from.scrollLeft;
    if (to.scrollLeft !== before) echoRef.current = to;
  };
  // Rendering every issue at once (about 12,000 editable cells for 1,000 issues) made the page
  // lag, so the register shows one page at a time. Search and Download still cover every match.
  const [pageSize, setPageSize] = useState(50);
  const query = q;
  // The page number belongs to one search/filter; changing either starts again at page 1.
  const viewKey = `${query}|${status}|${quick}|${JSON.stringify(columnFilters)}`;
  const [pageState, setPageState] = useState({ key: viewKey, page: 1 });
  const page = pageState.key === viewKey ? pageState.page : 1;
  const setPage = (n) => setPageState({ key: viewKey, page: n });
  const isMgr = ['Manager', 'Dept Head', 'Admin'].includes(session.role);
  const isAdmin = session.role === 'Admin';
  const canManageLifecycle = ['Manager', 'Admin'].includes(session.role);
  // Owners may close their own issue once proof is attached; only managers/admins reopen.
  const canCloseTask = (t) => canManageLifecycle || isOwnerOf(session, t);
  // Ticked issues (kept while paging and searching, so a selection can be built up).
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const canUpload = (t) => isMgr || isOwnerOf(session, t);
  // Every stored field can be edited in place by anyone who can work on the issue. Status, RGY,
  // days pending and escalation are calculated from the dates, so they change on their own.
  const canEditRow = (t) => Boolean(onPatchTask) && (t.status !== 'Closed'
    ? isMgr || isOwnerOf(session, t)
    : session.role === 'Owner' && isOwnerOf(session, t));
  const canOpenEdit = (t) => Boolean(onEditTask) && (isMgr || isOwnerOf(session, t));
  const canEditClosedRemark = (t) => t.status === 'Closed' && isMgr && Boolean(onSetRemark);
  const save = (t, key, value, { required = false } = {}) => {
    const next = typeof value === 'string' ? value.trim() : value;
    if ((t[key] ?? '') === (next ?? '')) return true;
    if (required && !next) return false;
    return onPatchTask(t.id, { [key]: next === '' ? null : next });
  };
  const departments = useMemo(
    () => departmentList || [...new Set([...DEFAULT_DEPARTMENTS, ...tasks.map((t) => t.dept)])].filter((d) => d && d !== 'Unassigned').sort(),
    [departmentList, tasks],
  );
  const selectable = Boolean(onDeleteMany || onEditTask || onBulkApply);
  function moveTracker(t, select) {
    const target = select.value;
    if (target !== t.manager && window.confirm(`Move ${t.id} to ${target}'s tracker?`)) onPatchTask(t.id, { manager: target });
    else select.value = t.manager;
  }
  const headings = useMemo(
    () => [...(isAdmin ? insertAfter(TRACKER_COLUMNS, 'Sr No', 'Manager') : TRACKER_COLUMNS), 'Document Proof', 'History'],
    [isAdmin],
  );
  const filterableHeadings = useMemo(() => headings.filter((heading) => heading !== 'History'), [headings]);

  const today = useMemo(() => todayProp || startOfToday(), [todayProp]);
  const responseNow = new Date();
  const viewCtx = useMemo(() => ({ today, session }), [today, session]);
  const viewTasks = useMemo(() => tasks.filter((task) => closedOnly ? task.status === 'Closed' : task.status !== 'Closed'), [tasks, closedOnly]);
  const matchingRows = useMemo(() => filterTasks(viewTasks, { q: query, status, quick }, viewCtx), [viewTasks, query, status, quick, viewCtx]);
  const rows = useMemo(() => matchingRows.filter((task) => Object.entries(columnFilters).every(
    ([heading, value]) => normalizeFilterValue(getColumnFilterValue(task, heading)) === value,
  )), [matchingRows, columnFilters]);
  const filterOptions = useMemo(() => Object.fromEntries(filterableHeadings.map((heading) => {
    const values = new Map();
    viewTasks.forEach((task) => {
      const value = getColumnFilterValue(task, heading);
      const key = normalizeFilterValue(value);
      if (!values.has(key)) values.set(key, value);
    });
    return [heading, [...values.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, label: value === '' ? '(Blank)' : String(value) }))];
  })), [viewTasks, filterableHeadings]);
  const hasColumnFilters = Object.keys(columnFilters).length > 0;
  const quickCounts = useMemo(() => countQuickViews(viewTasks, viewCtx), [viewTasks, viewCtx]);
  const current = cleanView({ q: query, status, quick });
  const activeSaved = hasColumnFilters ? null : savedViews.find((v) => JSON.stringify(cleanView(v.filters)) === JSON.stringify(current));
  const openView = (filters) => {
    const v = cleanView(filters);
    setQ(v.q);
    setStatus(v.status);
    setQuick(v.quick);
    setColumnFilters({});
  };
  const setColumnFilter = (heading, value) => setColumnFilters((currentFilters) => {
    const next = { ...currentFilters };
    if (value === '') delete next[heading];
    else next[heading] = value;
    return next;
  });
  async function saveCurrentView(e) {
    e.preventDefault();
    const name = (naming || '').trim();
    if (!name || hasColumnFilters) return;
    if (await onSaveView(name, current)) setNaming(null);
  }
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = useMemo(() => rows.slice((currentPage - 1) * pageSize, currentPage * pageSize), [rows, currentPage, pageSize]);
  useEffect(() => {
    setStatus(closedOnly ? 'Closed' : 'Active');
    setQ('');
    setQuick('all');
    setColumnFilters({});
  }, [closedOnly]);
  useEffect(() => {
    if (!navigationRequest || navigationRequest.closedOnly !== closedOnly) return;
    setQ(navigationRequest.id);
    setStatus(closedOnly ? 'Closed' : 'Active');
    setQuick('all');
    setColumnFilters({});
  }, [navigationRequest, closedOnly]);
  useEffect(() => {
    if (!navigationRequest || navigationRequest.closedOnly !== closedOnly || !pageRows.some((task) => task.id === navigationRequest.id)) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const row = [...document.querySelectorAll('[data-task-id]')].find((element) => element.getAttribute('data-task-id') === navigationRequest.id);
      if (!row) return;
      row.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      onNavigationHandled?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [navigationRequest, closedOnly, pageRows, onNavigationHandled]);
  // Only issues still in the register count (one may have been deleted by a teammate meanwhile).
  const selectedTasks = useMemo(() => tasks.filter((t) => selected.has(t.id)), [tasks, selected]);
  const selectedIds = selectedTasks.map((t) => t.id);
  const pageAllSelected = pageRows.length > 0 && pageRows.every((t) => selected.has(t.id));
  const pageSomeSelected = pageRows.some((t) => selected.has(t.id));
  const toggle = (id) => setSelected((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const togglePage = () => setSelected((cur) => {
    const next = new Set(cur);
    pageRows.forEach((t) => (pageAllSelected ? next.delete(t.id) : next.add(t.id)));
    return next;
  });
  const closable = selectedTasks.filter((t) => t.status !== 'Closed' && (t.proofs || []).length > 0 && canCloseTask(t));
  const reopenable = selectedTasks.filter((t) => t.status === 'Closed');
  async function bulk(fn) {
    setBulkBusy(true);
    try { return await fn(); } finally { setBulkBusy(false); }
  }

  function exportExcel() {
    downloadXlsx(`brembo-issues-${fmtDate(startOfToday())}.xlsx`, TASK_EXPORT_HEADERS, taskExportRows(rows), {
      sheetName: 'Issues', dateColumns: TASK_EXPORT_DATE_COLUMNS, wrapColumns: TASK_EXPORT_WRAP_COLUMNS,
    });
  }

  const colSpan = headings.length + (selectable ? 1 : 0);

  return (
    <div>
      <div className="flex flex-col gap-3 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[19px] font-bold mb-1 text-brembo-ink">{closedOnly ? 'Closed Issues' : 'Task Register'}</h1>
            <p className="text-brembo-sub text-[13px]">
              {closedOnly
                ? 'Closed issues are kept separate from active work. Managers can review proof and reopen an issue when follow-up is needed.'
                : 'Active issues only. Click editable cells to save changes to History. Platform Managers can create issues and import trackers; owners upload proof, respond to target dates, and can close their own issues.'}
            </p>
          </div>
          {(closedOnly ? onShowActiveRegister : onShowClosedIssues) && (
            <button type="button" onClick={closedOnly ? onShowActiveRegister : onShowClosedIssues} className="inline-flex items-center gap-1.5 border border-brembo-line text-brembo-ink hover:border-brembo-red rounded-full px-4 py-2 text-[12px] font-bold bg-white shrink-0">
              {closedOnly ? 'Active Task Register' : 'Closed Issues'}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!closedOnly && onAddIssue && (
            <button onClick={onAddIssue} className="inline-flex items-center gap-1.5 bg-brembo-red hover:bg-[#e52d45] text-white rounded-full px-4 py-2 text-[12.5px] font-bold">
              <Plus size={14} /> Add issue
            </button>
          )}
          {!closedOnly && onImportExcel && (
            <button type="button" onClick={onImportExcel} className="inline-flex items-center gap-1.5 border border-brembo-line text-brembo-ink hover:border-brembo-red rounded-full px-4 py-2 text-[12.5px] font-bold bg-white">
              <FileSpreadsheet size={14} /> Import from Excel
            </button>
          )}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="bg-white border border-brembo-line rounded-full px-4 py-2 text-[12.5px] w-44 md:w-56 shadow-card" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-white border border-brembo-line rounded-full px-3 py-2 text-[12.5px] shadow-card">
            {(closedOnly ? ['Closed'] : ['Active', 'All', 'Overdue', 'Due Soon', 'On Track', 'No Target Date', 'Open']).map((s) => <option key={s}>{s}</option>)}
          </select>
          <button
            type="button"
            onClick={exportExcel}
            disabled={!rows.length}
            className="inline-flex items-center gap-1.5 bg-brembo-red hover:bg-[#e52d45] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-full px-4 py-2 text-[12.5px] font-bold"
          >
            <Download size={14} /> Download Excel
          </button>
        </div>
      </div>
      {!closedOnly && <div className="flex flex-wrap items-center gap-1.5 mb-3" role="toolbar" aria-label="Views">
        {QUICK_VIEWS.map((v) => (
          <button key={v.id} type="button" onClick={() => setQuick(v.id)} aria-pressed={quick === v.id}
            className={`rounded-full px-3 py-1 text-[11.5px] font-semibold border ${quick === v.id ? 'bg-brembo-ink text-white border-brembo-ink' : 'bg-white text-brembo-sub border-brembo-line hover:border-brembo-red hover:text-brembo-ink'}`}>
            {v.label} <span className={`tabular-nums ${quick === v.id ? 'text-white/70' : 'text-brembo-sub/80'}`}>{quickCounts[v.id]}</span>
          </button>
        ))}
        {onSaveView && (
          <>
            <span className="w-px h-5 bg-brembo-line mx-1" />
            {savedViews.map((v) => (
              <span key={v.id} className={`inline-flex items-center rounded-full border text-[11.5px] font-semibold ${activeSaved?.id === v.id ? 'bg-brembo-red text-white border-brembo-red' : 'bg-white border-brembo-line text-brembo-ink hover:border-brembo-red'}`}>
                <button type="button" onClick={() => openView(v.filters)} title={describeView(v.filters)} className="inline-flex items-center gap-1 pl-3 pr-1.5 py-1"><Bookmark size={11} /> {v.name}</button>
                <button type="button" onClick={() => window.confirm(`Delete the saved view "${v.name}"?`) && onDeleteView(v)} aria-label={`Delete saved view ${v.name}`} className="pr-2 opacity-60 hover:opacity-100"><X size={11} /></button>
              </span>
            ))}
            {naming === null ? (
              <button type="button" onClick={() => setNaming('')} disabled={Boolean(activeSaved) || hasColumnFilters} title={hasColumnFilters ? 'Clear column filters to save this view' : activeSaved ? 'This view is already saved' : `Save: ${describeView(current)}`}
                className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11.5px] font-semibold border border-dashed border-brembo-line text-brembo-sub hover:border-brembo-red hover:text-brembo-red disabled:opacity-40">
                <BookmarkPlus size={12} /> Save this view
              </button>
            ) : (
              <form onSubmit={saveCurrentView} className="inline-flex items-center gap-1">
                <input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNaming(null)} maxLength={60} placeholder="Name this view" aria-label="Name for the saved view" className="bg-white border border-brembo-red rounded-full px-3 py-1 text-[11.5px] w-40 focus:outline-none" />
                <button type="submit" disabled={!naming.trim() || hasColumnFilters} className="rounded-full px-3 py-1 text-[11.5px] font-bold bg-brembo-red text-white disabled:opacity-40">Save</button>
                <button type="button" onClick={() => setNaming(null)} className="text-brembo-sub hover:text-brembo-ink" aria-label="Cancel"><X size={13} /></button>
              </form>
            )}
          </>
        )}
      </div>}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="text-[11px] text-brembo-sub">
          {rows.length} of {viewTasks.length} issues{rows.length > pageSize && <> · showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, rows.length)}</>}
          {hasColumnFilters && (
            <button type="button" onClick={() => setColumnFilters({})} className="ml-2 text-brembo-red font-semibold hover:underline">
              Clear column filters
            </button>
          )}
          {onToggleArchived && (
            <label className="ml-3 inline-flex items-center gap-1 cursor-pointer" title="Issues closed more than a year ago are archived and not loaded unless you ask for them.">
              <input type="checkbox" checked={showArchived} onChange={onToggleArchived} className="accent-brembo-red" /> Show archived{showArchived ? ` (${archivedCount})` : ''}
            </label>
          )}
          {selectable && pageAllSelected && rows.length > pageRows.length && !rows.every((t) => selected.has(t.id)) && (
            <button type="button" onClick={() => setSelected((cur) => new Set([...cur, ...rows.map((t) => t.id)]))} className="ml-2 text-brembo-red font-bold hover:underline">Select all {rows.length} matching</button>
          )}
        </div>
        <Pager page={currentPage} pageCount={pageCount} setPage={setPage} pageSize={pageSize} setPageSize={(n) => { setPageSize(n); setPage(1); }} />
      </div>
      {selectedIds.length > 0 && (
        <BulkBar
          count={selectedIds.length}
          employees={employees}
          departments={departments}
          busy={bulkBusy}
          canDelete={Boolean(onDeleteMany)}
          canReopen={canManageLifecycle}
          closableCount={closable.length}
          reopenableCount={reopenable.length}
          onApply={onBulkApply ? (field, value) => bulk(() => onBulkApply(selectedIds, field, value)) : undefined}
          onClose={() => bulk(() => onBulkClose(closable.map((t) => t.id)))}
          onReopen={() => bulk(() => onBulkReopen(reopenable.map((t) => t.id)))}
          onDelete={() => bulk(async () => { if (await onDeleteMany(selectedIds)) setSelected(new Set()); })}
          onEditOne={onEditTask ? () => onEditTask(selectedIds[0]) : undefined}
          onClear={() => setSelected(new Set())}
        />
      )}
      <div ref={sheetRef} onScroll={() => syncScroll(sheetRef.current, sliderRef.current)} className={`table-scroll border border-[#1b5e3c] rounded-sm overflow-auto bg-white shadow-defined ${slider.show ? 'no-scrollbar' : ''}`}>
        <table className="issue-sheet w-full min-w-[1680px] text-[12px]">
          <thead>
            <tr>
              {selectable && (
                <th className="px-2 py-2 sticky top-0 z-10">
                  <input type="checkbox" checked={pageAllSelected} ref={(el) => { if (el) el.indeterminate = !pageAllSelected && pageSomeSelected; }} onChange={togglePage} aria-label="Select all issues on this page" className="accent-brembo-red" />
                </th>
              )}
              {headings.map((h) => (
                <th
                  key={h}
                  className={`text-left px-2 py-2 whitespace-nowrap sticky top-0 z-10 ${
                    h === 'Issue Description' ? 'min-w-[320px]' : h === 'Remarks' ? 'min-w-[180px]' : h === 'Document Proof' ? 'min-w-[170px]' : ''
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
            <tr>
              {selectable && <th className="sticky top-8 z-10 px-1 py-1" aria-label="Selection column" />}
              {headings.map((heading) => (
                <th key={`${heading}-filter`} className="sticky top-8 z-10 px-1 py-1">
                  {heading === 'History' ? (
                    <span className="text-[10px] font-normal text-white/70">Actions</span>
                  ) : (
                    <select
                      value={Object.prototype.hasOwnProperty.call(columnFilters, heading) ? JSON.stringify(columnFilters[heading]) : ''}
                      onChange={(event) => setColumnFilter(heading, event.target.value === '' ? '' : JSON.parse(event.target.value))}
                      aria-label={`Filter by ${heading}`}
                      title={`Filter by ${heading}`}
                      className="w-full min-w-[64px] max-w-[150px] rounded border border-[#d4ded7] bg-white px-1 py-1 text-[10.5px] font-normal text-brembo-ink"
                    >
                      <option value="">All</option>
                      {filterOptions[heading].map(({ key, label }) => (
                        <option key={key} value={JSON.stringify(key)}>{label}</option>
                      ))}
                    </select>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={colSpan} className="px-3 py-6 text-center text-brembo-sub">No issues match this view and search.</td></tr>
            ) : pageRows.map((t) => {
              const displayState = getTaskStatusPresentation(t);
              const daysPending = getDaysPending(t.start, t.due);
              const editable = canEditRow(t);
              const dueAcceptance = dueAcceptanceOf(t, responseNow);
              const canOwnerRespond = t.status !== 'Closed' && session.role === 'Owner' && isOwnerOf(session, t) && dueAcceptance.status === 'pending';
              const cells = {
                'Sr No': editable ? <EditText value={t.srNo ?? getSerialNumber(t.id)} onSave={(v) => save(t, 'srNo', v || null)} width="w-[58px]" /> : t.srNo ?? getSerialNumber(t.id),
                Manager: editable && isAdmin ? <select key={`${t.id}-${t.manager}`} defaultValue={t.manager} onChange={(e) => moveTracker(t, e.target)} className={cellInput}>{[...new Set([t.manager, ...managers])].map((m) => <option key={m} value={m}>{m}</option>)}</select> : t.manager || '',
                Customer: editable ? <EditText value={t.customer} onSave={(v) => save(t, 'customer', v)} width="w-[110px]" /> : t.customer || '',
                'Program Name': editable ? <EditText value={t.program} onSave={(v) => save(t, 'program', v, { required: true })} width="w-[150px]" /> : t.program || '',
                'Issue Description': editable ? <EditText value={t.desc} multiline onSave={(v) => save(t, 'desc', v, { required: true })} width="w-full" /> : t.desc || '',
                Dept: editable ? <EditText value={t.dept === 'Unassigned' ? '' : t.dept} list="register-departments" placeholder="Unassigned" onSave={(v) => save(t, 'dept', v || 'Unassigned')} width="w-[90px]" /> : t.dept || 'Unassigned',
                Owner: editable ? <OwnerPicker value={t.owner} employees={employees} onCommit={(v) => onSetOwner(t.id, v)} className={`${cellInput} w-[150px]`} placeholder="Unassigned" ariaLabel={`Owner of ${t.id}`} /> : t.owner || '',
                'Start Date': editable ? <EditDate value={t.start} required onSave={(v) => save(t, 'start', v || null, { required: true })} /> : t.start || '',
                'Target Date': <div className="min-w-[138px]">
                  {editable && ['Manager', 'Dept Head', 'Admin'].includes(session.role) ? <EditDate value={t.due} required onSave={(v) => onSetDue(t.id, v)} /> : t.due || ''}
                  {t.due && <div className="mt-1 text-[10px] text-brembo-sub">
                    {canOwnerRespond ? <span className="inline-flex flex-wrap items-center gap-1.5">
                      <span>Respond within 3 days</span>
                      <button type="button" onClick={() => onSetDueAcceptance(t.id, 'accepted')} className="text-brembo-green font-bold hover:underline">Accept</button>
                      <button type="button" onClick={() => onSetDueAcceptance(t.id, 'rejected')} className="text-brembo-red font-bold hover:underline">Reject</button>
                    </span> : dueAcceptance.status === 'auto_accepted' ? 'Auto-accepted' : dueAcceptance.status === 'rejected' ? 'Rejected — awaiting revised date' : dueAcceptance.status === 'accepted' ? 'Accepted' : dueAcceptance.status === 'pending' ? 'Awaiting owner response' : null}
                  </div>}
                </div>,
                'Next Date': editable ? <EditDate value={t.next} onSave={(v) => onSetNextDate ? onSetNextDate(t.id, v || null) : save(t, 'next', v || null)} /> : t.next || '',
                'Actual Close Date': editable && isMgr && t.closed ? <EditDate value={t.closed} onSave={(v) => v ? save(t, 'closed', v) : onReopen(t.id)} /> : t.closed || '',
                'Days Pending': daysPending,
                Status: <><Pill tone={displayState.tone}>{t.status}</Pill>{editable && onToggleRedFlag && <button type="button" onClick={() => onToggleRedFlag(t.id)} title={t.redFlag ? 'Remove Red Flag' : 'Raise Red Flag'} aria-label={`${t.redFlag ? 'Remove' : 'Raise'} Red Flag for ${t.id}`} className={`ml-1.5 align-middle ${t.redFlag ? 'text-brembo-red' : 'text-brembo-sub hover:text-brembo-red'}`}><FlagTriangleRight size={13} fill={t.redFlag ? 'currentColor' : 'none'} /></button>}{canOpenEdit && onEditTask && <button type="button" onClick={() => onEditTask(t.id)} title={t.status === 'Closed' ? 'Review issue, add a remark, or reopen it' : 'Edit issue details'} aria-label={`Edit or review issue ${t.id}`} className="ml-1.5 text-brembo-sub hover:text-brembo-red align-middle"><Pencil size={12} /></button>}{editable && canCloseTask(t) && (t.proofs || []).length > 0 && <button type="button" onClick={() => onClose(t.id)} title={isMgr ? 'Close after reviewing proof' : 'Close this issue (your manager can reopen it)'} aria-label={`Close ${t.id} after reviewing proof`} className="ml-1.5 text-brembo-sub hover:text-brembo-green align-middle"><Check size={13} /></button>}{canManageLifecycle && t.status === 'Closed' && <button type="button" onClick={() => onReopen(t.id)} title="Reopen and send back to owner" className="ml-1.5 text-brembo-sub hover:text-brembo-red align-middle"><RotateCcw size={12} /></button>}</>,
                RGY: <Pill tone={displayState.tone}>{displayState.label}</Pill>,
                Remarks: (t.status !== 'Closed' && (editable || isMgr || isOwnerOf(session, t))) || canEditClosedRemark(t) ? <EditText value={t.remark} placeholder="Add remark" multiline onSave={(v) => v !== (t.remark || '') && onSetRemark(t.id, v)} width="w-[170px]" /> : <div className="text-[11.5px] max-w-[170px] whitespace-normal">{t.remark || ''}</div>,
                'Escalation Level': t.esc === 'None' ? '' : (t.esc || ''),
                'Document Proof': <div className="flex flex-col gap-1 min-w-[150px]">{(t.proofs || []).map((p) => <div key={p.id} className="flex items-center gap-1.5 bg-white border border-[#c8c8c8] px-2 py-1 rounded-sm text-[11px]"><Paperclip size={11} className="shrink-0" /><button type="button" onClick={() => onViewProof(t, p)} className="truncate max-w-[130px] text-left hover:text-brembo-red" title={`View ${p.name}`}>{p.name}</button><button type="button" onClick={() => onViewProof(t, p)} className="text-brembo-sub hover:text-brembo-ink" aria-label={`View ${p.name}`} title={`View ${p.name}`}><Eye size={11} /></button>{canRemoveProof(session, t, p) && <button type="button" onClick={() => onRemoveProof(t.id, p)} className="ml-auto text-brembo-red hover:bg-brembo-red/10 rounded-sm p-0.5" title={`Remove ${p.name}`} aria-label={`Remove proof ${p.name}`}><X size={12} /></button>}</div>)}{canUpload(t) ? <label className="inline-flex items-center gap-1.5 w-fit bg-white border border-dashed border-[#8aae96] hover:border-brembo-red hover:text-brembo-red text-brembo-sub px-2.5 py-1 rounded-sm text-[11px] cursor-pointer"><Upload size={11} />{(t.proofs || []).length ? 'Add more' : 'Upload Proof'}<input type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => { if (e.target.files.length) onAddProof(t.id, [...e.target.files]); e.target.value = ''; }} /></label> : !(t.proofs || []).length ? <span className="text-brembo-sub">—</span> : null}</div>,
                History: <div className="flex flex-col items-start gap-1"><button type="button" onClick={() => onShowHistory(t)} className="inline-flex items-center gap-1 text-[11px] text-brembo-sub hover:text-brembo-red" aria-label={`Show history and comments of ${t.id}`}><History size={12} /> View · Comment</button>{canOpenEdit && <button type="button" onClick={() => onEditTask(t.id)} className="inline-flex items-center gap-1 text-[11px] text-brembo-sub hover:text-brembo-red" aria-label={`${t.status === 'Closed' ? 'Review' : 'Edit'} issue ${t.id}`}><Pencil size={11} /> {t.status === 'Closed' ? 'Review issue' : 'Edit issue'}</button>}</div>,
              };
              return (
                <tr key={t.id} data-id={t.id} data-task-id={t.id} tabIndex={canOpenEdit ? 0 : undefined}
                  onClick={(event) => {
                    if (!canOpenEdit || event.target.closest('button,input,select,textarea,a,label,[role="button"]')) return;
                    onEditTask(t.id);
                  }}
                  onKeyDown={(event) => { if (canOpenEdit && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onEditTask(t.id); } }}
                  title={canOpenEdit ? `${t.status === 'Closed' ? 'Review' : 'Click to edit'} ${t.id}` : undefined}
                  className={`align-top ${RYGB_ROW[getTaskRowTone(t)]} ${selected.has(t.id) ? 'outline outline-1 outline-brembo-red/40' : ''} ${canOpenEdit ? 'cursor-pointer' : ''}`}>
                  {selectable && (
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={selected.has(t.id)}
                        onChange={() => toggle(t.id)}
                        aria-label={`Select issue ${t.id}`}
                        className="accent-brembo-red"
                      />
                    </td>
                  )}
                  {headings.map((heading) => <td key={heading} className={`px-2 py-1.5 ${heading === 'Issue Description' ? 'min-w-[320px] max-w-[460px] whitespace-normal break-words' : heading === 'Days Pending' ? 'whitespace-nowrap text-right' : heading === 'Remarks' ? 'min-w-[180px]' : heading === 'Escalation Level' ? 'min-w-[140px] whitespace-normal' : heading === 'Document Proof' ? 'align-top' : 'whitespace-nowrap'}`}>{cells[heading]}</td>)}
                </tr>
              );
            })}
          </tbody>
        </table>
        <datalist id="register-departments">{departments.map((d) => <option key={d} value={d} />)}</datalist>
      </div>
      {/* -bottom-10 cancels the page's pb-10, so the slider rests on the bottom edge of the screen. */}
      <div ref={sliderRef} onScroll={() => syncScroll(sliderRef.current, sheetRef.current)} aria-hidden="true"
        className={`table-scroll sticky -bottom-10 z-20 overflow-y-hidden border-x border-transparent bg-[#efe8ea] print:hidden ${slider.show ? '' : 'hidden'}`}>
        <div style={{ width: slider.width, height: 1 }} />
      </div>
      {pageCount > 1 && (
        <div className="flex justify-end mt-2">
          <Pager page={currentPage} pageCount={pageCount} setPage={setPage} pageSize={pageSize} setPageSize={(n) => { setPageSize(n); setPage(1); }} />
        </div>
      )}
    </div>
  );
}

function Pager({ page, pageCount, setPage, pageSize, setPageSize }) {
  const btn = 'inline-flex items-center justify-center w-7 h-7 rounded-full border border-brembo-line bg-white hover:border-brembo-red disabled:opacity-40 disabled:cursor-not-allowed';
  return (
    <div className="flex items-center gap-2 text-[11.5px] text-brembo-sub">
      <label className="flex items-center gap-1">Rows
        <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} aria-label="Rows per page" className="bg-white border border-brembo-line rounded-full px-2 py-1">
          {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <button type="button" className={btn} onClick={() => setPage(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={14} /></button>
      <span className="tabular-nums">Page {page} of {pageCount}</span>
      <button type="button" className={btn} onClick={() => setPage(page + 1)} disabled={page >= pageCount} aria-label="Next page"><ChevronRight size={14} /></button>
    </div>
  );
}

const cellInput = 'border border-transparent hover:border-[#c8c8c8] focus:border-brembo-red focus:outline-none bg-transparent focus:bg-white rounded-sm px-1.5 py-0.5 text-[11.5px]';

// Saves when the person leaves the cell or presses Enter; Escape puts the old value back.
function EditText({ value, onSave, multiline = false, width = '', placeholder = '', list }) {
  const shown = value ?? '';
  const common = {
    defaultValue: shown,
    placeholder,
    title: 'Click to edit',
    className: `${cellInput} ${width} ${multiline ? 'resize-y min-h-[2.2em] whitespace-pre-wrap align-top leading-snug' : ''}`,
    onBlur: (e) => { if (e.target.value !== shown && onSave(e.target.value) === false) e.target.value = shown; },
    onKeyDown: (e) => {
      if (e.key === 'Escape') { e.target.value = shown; e.target.blur(); }
      if (e.key === 'Enter' && (!multiline || !e.shiftKey)) { e.preventDefault(); e.target.blur(); }
    },
  };
  return multiline
    ? <textarea key={shown} rows={Math.min(4, Math.max(1, Math.ceil(shown.length / 60)))} {...common} />
    : <input key={shown} list={list} {...common} />;
}

function EditDate({ value, onSave, required = false }) {
  const shown = value || '';
  return <input key={shown} type="date" defaultValue={shown} required={required} aria-required={required} title={required ? 'Target date is required' : 'Click to edit'} onBlur={(e) => {
    if (e.target.value === shown) return;
    if (required && !e.target.value) { e.target.value = shown; return; }
    const saved = onSave(e.target.value);
    if (saved === false) e.target.value = shown;
  }} className={cellInput} />;
}

function insertAfter(list, after, item) {
  const index = list.indexOf(after);
  if (index < 0) return [...list, item];
  return [...list.slice(0, index + 1), item, ...list.slice(index + 1)];
}

function getDaysPending(start, due) {
  if (!start || !due) return '';
  const startTime = Date.parse(`${start}T00:00:00`);
  const dueTime = Date.parse(`${due}T00:00:00`);
  if (!Number.isFinite(startTime) || !Number.isFinite(dueTime)) return '';
  return Math.round((dueTime - startTime) / 86400000);
}

function getSerialNumber(id) {
  const match = String(id || '').match(/(?:^|-)(\d+)$/);
  return match ? match[1] : id || '';
}

function normalizeFilterValue(value) {
  return String(value ?? '').trim().toLocaleLowerCase();
}

function getColumnFilterValue(task, heading) {
  switch (heading) {
    case 'Sr No': return task.srNo ?? getSerialNumber(task.id);
    case 'Manager': return task.manager || '';
    case 'Customer': return task.customer || '';
    case 'Program Name': return task.program || '';
    case 'Issue Description': return task.desc || '';
    case 'Dept': return task.dept || 'Unassigned';
    case 'Owner': return task.owner || '';
    case 'Start Date': return task.start || '';
    case 'Target Date': return task.due || '';
    case 'Next Date': return task.next || '';
    case 'Actual Close Date': return task.closed || '';
    case 'Days Pending': return getDaysPending(task.start, task.due);
    case 'Status': return task.status || '';
    case 'RGY': return task.rgy || '';
    case 'Remarks': return task.remark || '';
    case 'Escalation Level': return task.esc === 'None' ? '' : task.esc || '';
    case 'Document Proof': return task.proofs?.length ? 'Has proof' : 'No proof';
    default: return '';
  }
}

// Status colours come from the shared RYGB theme (components/rygb.js).
function Pill({ tone, children }) {
  return <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold inline-block ${RYGB_PILL[tone] || RYGB_PILL.Grey}`}>{children}</span>;
}
