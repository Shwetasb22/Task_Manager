'use client';
import { useMemo, useState } from 'react';
import { Check, Pencil, Plus, Trash2, UserPlus, Wand2, X } from 'lucide-react';
import { ownerSpellingsReport } from '@/lib/employees';
import { normName, ownerTokens } from '@/lib/owners';
import { DEFAULT_DEPARTMENTS } from '@/lib/issues';
import AccessRequests from './AccessRequests';

const input = 'bg-white border border-brembo-line rounded-md px-2 py-1.5 text-[12.5px] focus:outline-none focus:border-brembo-red';
const btn = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold border';

// Employee list (who can own an issue) and a clean-up table for old spellings in the trackers.
// Admins, dept heads and managers maintain the list; only admins remove people.
export default function People({ session, employees, tasks, departments = [], accessRequests = [], trackers = [], onReviewAccess, onSave, onDelete, onRename, onSaveDepartment }) {
  const isAdmin = session.role === 'Admin';
  const canEditNames = session.role === 'Dept Head' || session.canEditOwnerNames === true;
  const [q, setQ] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [draft, setDraft] = useState({ name: '', email: '', department: '' });
  const [departmentDraft, setDepartmentDraft] = useState({ code: '', name: '' });
  const [editing, setEditing] = useState(null); // employee being edited (copy)
  const [busy, setBusy] = useState(false);
  const [choice, setChoice] = useState({}); // spelling -> chosen employee name

  const deptOptions = useMemo(() => [...new Set([...DEFAULT_DEPARTMENTS, ...departments, ...employees.map((e) => e.department)])].filter(Boolean).sort(), [departments, employees]);
  const issueCounts = useMemo(() => {
    const counts = new Map();
    tasks.forEach((t) => { if (t.status !== 'Closed') ownerTokens(t.owner).forEach((n) => counts.set(n, (counts.get(n) || 0) + 1)); });
    return counts;
  }, [tasks]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return employees.filter((e) => (showInactive || e.active !== false)
      && (!s || [e.name, e.email, e.department].some((v) => String(v || '').toLowerCase().includes(s))));
  }, [employees, q, showInactive]);
  const spellings = useMemo(() => ownerSpellingsReport(tasks, employees), [tasks, employees]);
  const activeNames = useMemo(() => employees.filter((e) => e.active !== false).map((e) => e.name), [employees]);

  async function run(fn) {
    setBusy(true);
    try { return await fn(); } finally { setBusy(false); }
  }
  async function add(e) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    if (await run(() => onSave({ ...draft, active: true }))) setDraft({ name: '', email: '', department: '' });
  }
  async function saveEdit() {
    if (await run(() => onSave(editing))) setEditing(null);
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-[19px] font-bold mb-1 text-brembo-ink">People</h1>
        <p className="text-brembo-sub text-[13px] max-w-3xl">
          Everyone who can own an issue. The Owner field in the Task Register and in Add issue suggests these names, so each person is always written the same way and sees all of their issues.
          {isAdmin ? ' You can add, edit, deactivate and remove people.' : ' You can add and edit people and mark leavers inactive.'}
        </p>
      </div>

      {isAdmin && onReviewAccess && <AccessRequests requests={accessRequests} trackers={trackers} onReview={onReviewAccess} />}

      <form onSubmit={add} className="bg-white border border-brembo-line rounded-lg p-3 mb-4 flex flex-wrap items-end gap-2 shadow-card">
        <label className="flex flex-col text-[11px] uppercase tracking-wide text-brembo-sub gap-1">Full name
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={`${input} w-52`} placeholder="e.g. Yogita Salunkhe" aria-label="New person name" />
        </label>
        <label className="flex flex-col text-[11px] uppercase tracking-wide text-brembo-sub gap-1">Outlook ID
          <input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className={`${input} w-60`} placeholder="name@bremboindia.com" aria-label="New person Outlook ID" />
        </label>
        <label className="flex flex-col text-[11px] uppercase tracking-wide text-brembo-sub gap-1">Department
          <input list="people-departments" value={draft.department} onChange={(e) => setDraft({ ...draft, department: e.target.value })} className={`${input} w-32`} aria-label="New person department" />
        </label>
        <button type="submit" disabled={busy || !draft.name.trim()} className={`${btn} bg-brembo-red border-brembo-red text-white disabled:opacity-50`}><UserPlus size={14} /> Add person</button>
      </form>

      <form onSubmit={async (e) => {
        e.preventDefault();
        if (!departmentDraft.code.trim() || !(await run(() => onSaveDepartment(departmentDraft)))) return;
        setDepartmentDraft({ code: '', name: '' });
      }} className="bg-white border border-brembo-line rounded-lg p-3 mb-4 flex flex-wrap items-end gap-2 shadow-card">
        <label className="flex flex-col text-[11px] uppercase tracking-wide text-brembo-sub gap-1">Department code
          <input value={departmentDraft.code} onChange={(e) => setDepartmentDraft({ ...departmentDraft, code: e.target.value })} className={`${input} w-40`} placeholder="e.g. QUALITY" aria-label="Department code" />
        </label>
        <label className="flex flex-col text-[11px] uppercase tracking-wide text-brembo-sub gap-1">Department name
          <input value={departmentDraft.name} onChange={(e) => setDepartmentDraft({ ...departmentDraft, name: e.target.value })} className={`${input} w-52`} placeholder="Optional display name" aria-label="Department name" />
        </label>
        <button type="submit" disabled={busy || !departmentDraft.code.trim()} className={`${btn} bg-brembo-red border-brembo-red text-white disabled:opacity-50`}><Plus size={14} /> Add department</button>
      </form>

      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" className="bg-white border border-brembo-line rounded-full px-4 py-2 text-[12.5px] w-56 shadow-card" />
        <label className="text-[12px] text-brembo-sub flex items-center gap-1.5"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="accent-brembo-red" /> Show inactive</label>
        <span className="text-[11px] text-brembo-sub ml-auto">{list.length} of {employees.length} people</span>
      </div>
      <div className="border border-brembo-line rounded-md overflow-auto bg-white shadow-card mb-6 max-h-[520px]">
        <table className="w-full text-[12.5px]">
          <thead className="bg-brembo-panel2 text-brembo-sub text-[11px] uppercase tracking-wide sticky top-0">
            <tr><th className="text-left px-3 py-2">Name</th><th className="text-left px-3 py-2">Outlook ID</th><th className="text-left px-3 py-2">Department</th><th className="text-right px-3 py-2">Open issues</th><th className="text-left px-3 py-2">Status</th><th className="px-3 py-2" aria-label="Actions" /></tr>
          </thead>
          <tbody>
            {list.map((e) => {
              const isEditing = editing?.id === e.id;
              return (
                <tr key={e.id || e.name} className={`border-t border-brembo-line ${e.active === false ? 'text-brembo-sub' : ''}`}>
                  <td className="px-3 py-1.5 font-semibold">{isEditing ? <input value={editing.name} disabled={!canEditNames} title={canEditNames ? '' : 'Only a dept head can edit owner names'} onChange={(ev) => setEditing({ ...editing, name: ev.target.value })} className={`${input} w-48 disabled:bg-brembo-panel2 disabled:text-brembo-sub`} aria-label="Name" /> : e.name}</td>
                  <td className="px-3 py-1.5">{isEditing ? <input value={editing.email || ''} onChange={(ev) => setEditing({ ...editing, email: ev.target.value })} className={`${input} w-56`} aria-label="Outlook ID" /> : e.email || <span className="text-brembo-sub">—</span>}</td>
                  <td className="px-3 py-1.5">{isEditing ? <input list="people-departments" value={editing.department || ''} onChange={(ev) => setEditing({ ...editing, department: ev.target.value })} className={`${input} w-28`} aria-label="Department" /> : e.department || <span className="text-brembo-sub">—</span>}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{issueCounts.get(normName(e.name)) || 0}</td>
                  <td className="px-3 py-1.5">
                    <button type="button" disabled={busy} onClick={() => run(() => onSave({ ...e, active: e.active === false }))} title={e.active === false ? 'Mark active' : 'Mark inactive (left the company)'}
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${e.active === false ? 'bg-[#ececee] text-[#4d4d55]' : 'bg-[#e3f6ea] text-[#146b38]'}`}>
                      {e.active === false ? 'Inactive' : 'Active'}
                    </button>
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-right">
                    {isEditing ? (
                      <>
                        <button type="button" onClick={saveEdit} disabled={busy} className="text-brembo-green hover:opacity-70 mr-2" aria-label={`Save ${e.name}`}><Check size={15} /></button>
                        <button type="button" onClick={() => setEditing(null)} className="text-brembo-sub hover:text-brembo-ink" aria-label="Cancel"><X size={15} /></button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => setEditing({ ...e })} className="text-brembo-sub hover:text-brembo-red mr-2" aria-label={`Edit ${e.name}`}><Pencil size={14} /></button>
                        {isAdmin && <button type="button" disabled={busy} onClick={() => window.confirm(`Remove ${e.name} from the list? Their issues are not changed.`) && run(() => onDelete(e))} className="text-brembo-sub hover:text-brembo-red" aria-label={`Remove ${e.name}`}><Trash2 size={14} /></button>}
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-brembo-sub">No one matches your search.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 className="text-[15px] font-bold text-brembo-ink mb-1">Names in the trackers that are not on the list</h2>
      <p className="text-brembo-sub text-[12.5px] mb-2 max-w-3xl">
        Old or misspelled names. Choose the right person and press Replace to fix the spelling in every issue {isAdmin ? '' : 'in your tracker '}(each change is saved in the issue history), or add the name to the list if it is a new person.
      </p>
      <div className="border border-brembo-line rounded-md overflow-auto bg-white shadow-card">
        <table className="w-full text-[12.5px]">
          <thead className="bg-brembo-panel2 text-brembo-sub text-[11px] uppercase tracking-wide">
            <tr><th className="text-left px-3 py-2">Name in tracker</th><th className="text-right px-3 py-2">Issues</th><th className="text-left px-3 py-2">Trackers</th><th className="text-left px-3 py-2">Replace with</th><th className="px-3 py-2" aria-label="Actions" /></tr>
          </thead>
          <tbody>
            {spellings.map((row) => {
              const target = choice[row.name] ?? row.suggestion?.name ?? '';
              return (
                <tr key={row.name} className="border-t border-brembo-line">
                  <td className="px-3 py-1.5 font-semibold">{row.name}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{row.uses}</td>
                  <td className="px-3 py-1.5 text-brembo-sub">{row.trackers.join(', ')}</td>
                  <td className="px-3 py-1.5">
                    <select value={target} onChange={(e) => setChoice({ ...choice, [row.name]: e.target.value })} className={`${input} w-52`} aria-label={`Replace ${row.name} with`}>
                      <option value="">Choose a person…</option>
                      {activeNames.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-1.5 whitespace-nowrap text-right">
                    <button type="button" disabled={busy || !target || !canEditNames} title={!canEditNames ? 'Only a dept head can edit owner names' : ''} onClick={() => window.confirm(`Replace "${row.name}" with "${target}" in ${row.uses} issue(s)?`) && run(() => onRename(row.name, target))} className={`${btn} border-brembo-line bg-white hover:border-brembo-red disabled:opacity-40 mr-2`}><Wand2 size={13} /> Replace</button>
                    <button type="button" disabled={busy} onClick={() => run(() => onSave({ name: row.name, active: true }))} className={`${btn} border-brembo-line bg-white hover:border-brembo-red`}><Plus size={13} /> Add to list</button>
                  </td>
                </tr>
              );
            })}
            {!spellings.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-brembo-sub">Every owner name in your issues is on the list.</td></tr>}
          </tbody>
        </table>
      </div>
      <datalist id="people-departments">{deptOptions.map((d) => <option key={d} value={d} />)}</datalist>
    </div>
  );
}
