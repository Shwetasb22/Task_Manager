'use client';
import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, X } from 'lucide-react';
import { normalizeDepartment } from '@/lib/departments';
import { issuePrefix } from '@/lib/issues';
import { readWorkbook } from '@/lib/xlsx-reader';
import { FIELD_LABELS, parseTracker, planImport } from '@/lib/excel-import';
import { formatError } from '@/lib/errors';

const field = 'w-full bg-white border border-brembo-line rounded-md px-2.5 py-2 text-[13px] text-brembo-ink focus:outline-none focus:border-brembo-red';
const MAX_BYTES = 10 * 1024 * 1024;

const KIND = {
  add: { label: 'New issues', badge: 'New', tone: 'bg-[#e7f4ec] text-[#1d6b3a] border-[#b9dcc6]' },
  update: { label: 'Updates', badge: 'Update', tone: 'bg-[#fff6e0] text-[#7a5600] border-[#ecd79c]' },
  skip: { label: 'Skipped', badge: 'Skipped', tone: 'bg-brembo-red/10 text-[#9b1224] border-brembo-red/30' },
  same: { label: 'No change', badge: 'No change', tone: 'bg-[#f1f1f1] text-brembo-sub border-brembo-line' },
};
const ORDER = ['add', 'update', 'skip', 'same'];

const showValue = (field, value) => (value === null || value === undefined || value === '' ? 'empty' : field === 'desc' || field === 'remark' ? `"${value}"` : value);

function ItemRow({ item }) {
  const { row } = item;
  return (
    <li className="border-b border-brembo-line last:border-b-0 px-3 py-2.5 text-[12.5px]">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={`inline-block border rounded-full px-2 py-0.5 text-[10.5px] font-bold ${KIND[item.kind].tone}`}>{KIND[item.kind].badge}</span>
        <span className="font-bold text-brembo-ink">{item.task?.id || row.id || 'New ID'}</span>
        <span className="text-brembo-sub">{row.sheetName} · Excel row {row.rowNumber}</span>
      </div>
      <div className="mt-1 text-brembo-ink"><span className="font-semibold">{row.program || '(no program)'}</span> · {row.desc || '(no description)'}</div>
      {item.kind === 'add' && (
        <div className="mt-1 text-brembo-sub">Owner {row.owner || 'Unassigned'} · Dept {row.dept || 'Unassigned'} · Target {row.due || 'not set'}</div>
      )}
      {item.kind === 'update' && (
        <ul className="mt-1 space-y-0.5">
          {Object.entries(item.changes).map(([key, change]) => (
            <li key={key} className="text-brembo-sub break-words">
              <span className="text-brembo-ink font-semibold">{FIELD_LABELS[key]}:</span> {showValue(key, change.from)} → <span className="text-brembo-ink">{showValue(key, change.to)}</span>
            </li>
          ))}
        </ul>
      )}
      {item.reason && <div className="mt-1 text-[#9b1224]">{item.reason}</div>}
      {item.notes.map((note) => <div key={note} className="mt-1 text-[#7a5600]">{note}</div>)}
    </li>
  );
}

// tasks: every issue the person can see. onApply(manager, items, onProgress) saves the plan and
// resolves { added, updated, failed: [{ item, error }] }.
export default function ImportExcelModal({ session, managers, defaultManager, tasks, onApply, onClose }) {
  const isAdmin = session.role === 'Admin';
  const pickTracker = true;
  const managerOptions = session.role === 'Manager' ? [session.name].filter(Boolean) : managers;
  const [manager, setManager] = useState(isAdmin || session.role === 'Dept Head' ? defaultManager || managers[0] || '' : session.role === 'Manager' ? session.name : managers[0] || '');
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [view, setView] = useState('changes');
  const [replaceExisting, setReplaceExisting] = useState(false);

  const trackerTasks = useMemo(() => tasks.filter((t) => t.manager === manager), [tasks, manager]);
  const plan = useMemo(() => {
    if (!parsed) return null;
    const full = planImport(parsed, trackerTasks, { prefix: issuePrefix(tasks, manager), normalizeDept: normalizeDepartment });
    return full;
  }, [parsed, trackerTasks, tasks, manager]);
  const toApply = plan ? plan.items.filter((i) => i.kind === 'add' || i.kind === 'update') : [];
  const rowsRead = parsed ? parsed.rows.length + parsed.emptyRowsSkipped + parsed.ignoredRows.length : 0;
  const skipped = parsed
    ? parsed.emptyRowsSkipped + parsed.ignoredRows.length + (plan?.counts.same || 0) + (plan?.counts.skip || 0)
    : 0;
  const shown = plan
    ? plan.items.filter((i) => (view === 'changes' ? i.kind !== 'same' : view === i.kind)).sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind))
    : [];
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function chooseFile(file) {
    setError(''); setParsed(null); setResult(null); setView('changes');
    if (!file) return;
    setFileName(file.name);
    if (file.size > MAX_BYTES) { setError('This file is larger than 10 MB. Remove other sheets or images and try again.'); return; }
    setReading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      setParsed(parseTracker(readWorkbook(bytes, file.name), { normalizeDept: normalizeDepartment }));
    } catch (e) {
      setError(formatError(e));
    } finally {
      setReading(false);
    }
  }

  async function apply() {
    if (replaceExisting && !window.confirm('Permanently delete every existing issue and its attached proof files before importing this workbook? This cannot be undone.')) return;
    setBusy(true);
    setProgress({ done: 0, total: toApply.length });
    try {
      setResult(await onApply(manager, toApply, (done) => setProgress({ done, total: toApply.length }), replaceExisting));
    } catch (e) {
      setError(formatError(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start md:items-center justify-center p-3 md:p-6 bg-black/70 overflow-auto" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="import-title" className="glass-panel rounded-2xl w-full max-w-3xl p-5 md:p-6 my-auto">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 id="import-title" className="font-display text-xl font-bold">Import from Excel</h2>
            <p className="text-brembo-sub text-[12px] mt-1">
              Upload your OPL tracker (.xlsx or .csv). You will see every new issue and change before anything is saved.
              Filled-in cells update the matching issue; empty cells never erase anything. Existing issues are deleted only when an admin selects “Replace existing data”.
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="text-brembo-sub hover:text-brembo-ink"><X size={18} /></button>
        </div>

        {isAdmin && (
          <label className="mb-3 flex items-center gap-2 text-[12px] text-brembo-ink">
            <input type="checkbox" checked={replaceExisting} onChange={(e) => setReplaceExisting(e.target.checked)} disabled={busy} className="accent-brembo-red" />
            Replace existing data (permanently clears all issues before import)
          </label>
        )}

        {error && <div className="mb-4 text-xs px-3 py-2 rounded-md border bg-brembo-red/10 border-brembo-red/40 text-[#9b1224]" role="alert">{error}</div>}

        {result ? (
          <div className="space-y-3 text-[13px]">
            {result.error ? (
              <div className="px-3 py-2 rounded-md border bg-brembo-red/10 border-brembo-red/40 text-[#9b1224]" role="alert">{result.error}</div>
            ) : (
              <div className="px-3 py-2 rounded-md border bg-[#e7f4ec] border-[#b9dcc6] text-[#1d6b3a]" role="status">
                Rows read: {rowsRead} · Imported: {result.added + result.updated} · Skipped: {skipped}
                {parsed?.emptyRowsSkipped ? ` · Fully empty rows skipped: ${parsed.emptyRowsSkipped}` : ''}
                {parsed?.duplicateRowsSkipped ? ` · Repeated rows skipped: ${parsed.duplicateRowsSkipped}` : ''}
              </div>
            )}
            {plan && (plan.items.some((item) => item.kind === 'skip' || item.kind === 'same') || parsed?.ignoredRows.length || parsed?.emptyRowsSkipped) && (
              <div>
                <p className="font-bold mb-1">Skipped rows and reasons:</p>
                <ul className="max-h-40 overflow-auto border border-brembo-line rounded-md bg-white">
                  {(parsed?.ignoredRows || []).map((row) => (
                    <li key={`${row.sheetName}:${row.rowNumber}`} className="px-3 py-2 border-b border-brembo-line last:border-0">
                      {row.sheetName} · row {row.rowNumber}: {row.reason}
                    </li>
                  ))}
                  {parsed?.emptyRowsSkipped > 0 && (
                    <li className="px-3 py-2 border-b border-brembo-line last:border-0">{parsed.emptyRowsSkipped} fully empty row(s) were ignored.</li>
                  )}
                  {plan.items.filter((item) => item.kind === 'skip' || item.kind === 'same').map((item) => (
                    <li key={`${item.row.sheetName}:${item.row.rowNumber}`} className="px-3 py-2 border-b border-brembo-line last:border-0">
                      {item.row.sheetName} · row {item.row.rowNumber}: {item.reason || 'No changes to import.'}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.failed.length > 0 && (
              <div>
                <p className="font-bold text-[#9b1224] mb-1">{result.failed.length} row{result.failed.length === 1 ? '' : 's'} could not be saved:</p>
                <ul className="max-h-60 overflow-auto border border-brembo-line rounded-md bg-white">
                  {result.failed.map(({ item, error: why }) => (
                    <li key={`${item.row.sheetName}:${item.row.rowNumber}`} className="px-3 py-2 border-b border-brembo-line last:border-b-0">
                      {item.row.sheetName} · row {item.row.rowNumber} ({item.task ? item.task.id : 'new issue'}): {why}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex justify-end">
              <button type="button" onClick={onClose} className="bg-brembo-red hover:bg-[#e52d45] text-white rounded-full px-5 py-2 text-[12.5px] font-bold">Done</button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 mb-4">
              <label className="block">
                <span className="block text-[11px] uppercase tracking-wide text-brembo-sub mb-1">Tracker</span>
                {pickTracker ? (
                  <select id="import-tracker" value={manager} onChange={(e) => setManager(e.target.value)} className={field} disabled={busy}>
                    {managerOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : (
                  <div className="px-2.5 py-2 text-[13px] text-brembo-sub border border-brembo-line rounded-md">{manager}</div>
                )}
              </label>
              <label className="block">
                <span className="block text-[11px] uppercase tracking-wide text-brembo-sub mb-1">Excel file</span>
                <span className="flex items-center gap-2 bg-white border border-dashed border-brembo-line hover:border-brembo-red rounded-md px-2.5 py-2 text-[13px] cursor-pointer">
                  <FileSpreadsheet size={15} className="text-brembo-sub shrink-0" />
                  <span className="truncate">{reading ? 'Reading…' : fileName || 'Choose .xlsx or .csv file'}</span>
                  <input id="import-file" type="file" accept=".xlsx,.csv" className="sr-only" disabled={busy}
                    onChange={(e) => { chooseFile(e.target.files[0]); e.target.value = ''; }} />
                </span>
              </label>
            </div>

            {plan && (
              <>
                <p className="text-[12px] text-brembo-sub mb-2">
                  Read {parsed.rows.length + parsed.emptyRowsSkipped + parsed.ignoredRows.length} rows across {parsed.sheetCount} sheet(s); skipped {parsed.emptyRowsSkipped} blank, {parsed.duplicateRowsSkipped} repeated, and {parsed.ignoredRows.length - parsed.duplicateRowsSkipped} rows without usable issue details.
                </p>
                {parsed.warnings.map((w) => <div key={w} className="mb-2 text-xs px-3 py-2 rounded-md border bg-[#fff6e0] border-[#ecd79c] text-[#7a5600]">{w}</div>)}
                <div className="flex flex-wrap gap-2 mb-2" role="tablist" aria-label="Filter rows">
                  {[['changes', 'All changes', plan.counts.add + plan.counts.update + plan.counts.skip], ...ORDER.map((k) => [k, KIND[k].label, plan.counts[k]])].map(([key, label, count]) => (
                    <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)}
                      className={`rounded-full border px-3 py-1 text-[12px] font-bold ${view === key ? 'bg-brembo-ink text-white border-brembo-ink' : 'bg-white text-brembo-ink border-brembo-line hover:border-brembo-red'}`}>
                      {label} <span className="tabular-nums">{count}</span>
                    </button>
                  ))}
                </div>
                <ul className="max-h-[45vh] overflow-auto border border-brembo-line rounded-md bg-white mb-4">
                  {shown.length ? shown.map((item) => <ItemRow key={`${item.row.sheetName}:${item.row.rowNumber}`} item={item} />)
                    : <li className="px-3 py-6 text-center text-brembo-sub text-[12.5px]">{view === 'changes' ? 'Everything in this file already matches the app. Nothing to import.' : 'No rows here.'}</li>}
                </ul>
              </>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3">
              {progress && <span className="text-[12px] text-brembo-sub tabular-nums" role="status">Saving {progress.done} of {progress.total}…</span>}
              <button type="button" onClick={onClose} disabled={busy} className="border border-brembo-line rounded-full px-4 py-2 text-[12.5px] font-bold bg-white hover:border-brembo-red disabled:opacity-40">Cancel</button>
              <button type="button" onClick={apply} disabled={busy || !toApply.length}
                className="bg-brembo-red hover:bg-[#e52d45] text-white rounded-full px-5 py-2 text-[12.5px] font-bold disabled:opacity-40 disabled:cursor-not-allowed">
                {plan ? `Add ${plan.counts.add} and update ${plan.counts.update}` : 'Import'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
