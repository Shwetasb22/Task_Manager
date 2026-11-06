'use client';
import { useState } from 'react';
import { CalendarClock, Check, MessageSquarePlus, Pencil, RotateCcw, Trash2, UserRound, X } from 'lucide-react';
import OwnerPicker from './OwnerPicker';

const input = 'bg-white border border-brembo-line rounded-md px-2 py-1 text-[12px] focus:outline-none focus:border-brembo-red';
const apply = 'inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11.5px] font-bold bg-brembo-red text-white disabled:opacity-40';
const plain = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-bold border border-brembo-line bg-white hover:border-brembo-red disabled:opacity-40';

// Shown above the Task Register when issues are ticked: change many issues in one step.
// Each change is saved per issue (with its own history entry); issues that refuse it are reported.
export default function BulkBar({ count, employees, departments, busy, canDelete, canReopen, closableCount, reopenableCount, onApply, onClose, onReopen, onDelete, onEditOne, onClear }) {
  const [field, setField] = useState('due');
  const [value, setValue] = useState('');
  const label = { due: 'Target date', next: 'Next date', owner: 'Owner', dept: 'Department', remark: 'Add to remarks' }[field];
  const run = async () => {
    if (await onApply(field, value)) setValue('');
  };
  return (
    <div className="sticky top-0 z-20 mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-brembo-red/40 bg-[#fff6f7] px-3 py-2 shadow-card" role="region" aria-label="Change selected issues">
      <b className="text-[12.5px] text-brembo-ink">{count} selected</b>
      <button type="button" onClick={onClear} className="text-[11.5px] text-brembo-sub hover:text-brembo-red inline-flex items-center gap-0.5"><X size={12} /> Clear</button>
      <span className="w-px h-5 bg-brembo-line mx-1" />
      <label className="text-[11.5px] text-brembo-sub flex items-center gap-1.5">Change
        <select value={field} onChange={(e) => { setField(e.target.value); setValue(''); }} className={input} aria-label="Field to change">
          <option value="due">Target date</option>
          <option value="next">Next date</option>
          <option value="owner">Owner</option>
          <option value="dept">Department</option>
          <option value="remark">Add to remarks</option>
        </select>
      </label>
      {(field === 'due' || field === 'next') && <input type="date" value={value} onChange={(e) => setValue(e.target.value)} className={input} aria-label={`New ${label}`} />}
      {field === 'owner' && <OwnerPicker value={value} employees={employees} onChange={setValue} className={`${input} w-56`} ariaLabel="New owner" placeholder="Pick the new owner…" />}
      {field === 'dept' && (
        <select value={value} onChange={(e) => setValue(e.target.value)} className={input} aria-label="New department">
          <option value="">Choose…</option>
          {departments.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      )}
      {field === 'remark' && <input value={value} onChange={(e) => setValue(e.target.value)} className={`${input} w-64`} placeholder="Text added to each remark" aria-label="Remark to add" />}
      <button type="button" disabled={busy || (!value.trim() && field !== 'next')} onClick={run} className={apply}>
        {field === 'owner' ? <UserRound size={12} /> : field === 'remark' ? <MessageSquarePlus size={12} /> : <CalendarClock size={12} />} Apply to {count}
      </button>
      <span className="w-px h-5 bg-brembo-line mx-1" />
      {onEditOne && <button type="button" disabled={busy || count !== 1} onClick={onEditOne} className={plain} title={count === 1 ? 'Edit this issue' : 'Select exactly one issue to edit it in the form'}><Pencil size={12} /> Edit</button>}
      {closableCount > 0 && <button type="button" disabled={busy} onClick={onClose} className={plain} title="Closes the selected issues that have proof attached"><Check size={12} /> Close {closableCount} with proof</button>}
      {canReopen && reopenableCount > 0 && <button type="button" disabled={busy} onClick={onReopen} className={plain}><RotateCcw size={12} /> Reopen {reopenableCount}</button>}
      {canDelete && <button type="button" disabled={busy} onClick={onDelete} className={`${plain} text-brembo-red border-brembo-red/50`}><Trash2 size={12} /> Delete {count}</button>}
    </div>
  );
}
