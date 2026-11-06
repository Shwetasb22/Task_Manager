'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Eye, MessageSquareText, Paperclip, RotateCcw, Send, Upload, X } from 'lucide-react';
import { fmtDate } from '@/lib/data';
import { deriveTask, getTaskStatusPresentation, startOfToday } from '@/lib/rules';
import { normalizeDepartment } from '@/lib/departments';
import { DEFAULT_DEPARTMENTS, validateNewIssue } from '@/lib/issues';
import { unknownOwnerNames } from '@/lib/employees';
import { formatError } from '@/lib/errors';
import { ACCEPT, validateFile } from '@/lib/proofs';
import { isOwnerOf } from '@/lib/owners';
import { MAX_REMARK, remarkRecipients, remarkThread } from '@/lib/remarks';
import { store } from '@/lib/store';
import OwnerPicker from './OwnerPicker';

// Remarks exchanged between the manager and the owner(s) of one issue (stored as @mention comments).
function RemarkThread({ task, liveKey, recipients, message, setMessage, error, busy, onSend }) {
  const [thread, setThread] = useState(null);
  useEffect(() => {
    let alive = true;
    store.listTaskHistory(task.id)
      .then((events) => { if (alive) setThread(remarkThread(events)); })
      .catch(() => { if (alive) setThread([]); });
    return () => { alive = false; };
  }, [task.id, liveKey]);
  const toLabel = recipients.side === 'owner' ? `owner${recipients.names.length === 1 ? '' : 's'}` : 'manager';
  return (
    <div className="md:col-span-2 rounded-lg border border-brembo-line bg-white p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-brembo-sub">
        <MessageSquareText size={13} /> Remarks between manager and owner
      </div>
      <div className="max-h-44 space-y-1.5 overflow-auto">
        {thread === null && <div className="text-[11.5px] text-brembo-sub">Loading remarks…</div>}
        {thread && thread.length === 0 && <div className="text-[11.5px] text-brembo-sub">No remarks exchanged yet.</div>}
        {thread && thread.map((m) => (
          <div key={m.id} className="rounded-md border border-brembo-line bg-brembo-panel2 px-2.5 py-1.5 text-[11.5px]">
            <div className="flex justify-between gap-2 text-[10.5px] text-brembo-sub"><b className="text-brembo-ink">{m.by}</b><span>{m.at ? new Date(m.at).toLocaleString() : ''}</span></div>
            <div className="whitespace-pre-wrap break-words">{m.text}</div>
          </div>
        ))}
      </div>
      <label className="mt-2 block">
        <span className="mb-1 block text-[11px] uppercase tracking-wide text-brembo-sub">Remark to {toLabel} ({recipients.names.join(', ') || 'none'})</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} maxLength={MAX_REMARK} className={field}
          placeholder={recipients.side === 'owner' ? 'e.g. The uploaded proof is not signed — please upload the approved copy.' : 'e.g. Uploaded the approved report; please review.'} />
      </label>
      {error && <span className="mt-1 block text-[11px] text-[#9b1224]">{error}</span>}
      <div className="mt-2 flex justify-end">
        <button type="button" onClick={onSend} disabled={busy || !message.trim()} className="inline-flex items-center gap-1.5 rounded-full border border-brembo-line bg-white px-3.5 py-1.5 text-xs font-semibold text-brembo-ink hover:border-brembo-red disabled:opacity-50">
          <Send size={12} /> Send remark to {toLabel}
        </button>
      </div>
    </div>
  );
}

const uniqueValues = (tasks, key) => [...new Set(tasks.map((t) => t[key]).filter((v) => v && v !== 'Unassigned'))].sort();

function mostUsedTracker(tasks) {
  const counts = {};
  tasks.forEach((t) => { if (t.manager) counts[t.manager] = (counts[t.manager] || 0) + 1; });
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '';
}

const field = 'w-full bg-white border border-brembo-line rounded-md px-2.5 py-2 text-[13px] text-brembo-ink focus:outline-none focus:border-brembo-red';

function Field({ label, error, required, hint, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-brembo-sub mb-1">
        {label}{required && <span className="text-brembo-red"> *</span>}
      </span>
      {children}
      {hint && !error && <span className="block text-[11px] text-brembo-sub mt-1">{hint}</span>}
      {error && <span className="block text-[11px] text-[#9b1224] mt-1">{error}</span>}
    </label>
  );
}

// tasks: raw issues the person can see (used only to suggest customers, programs, owners and departments).
// Pass `task` to edit an existing issue instead of adding one.
export default function AddIssueModal({ session, managers, departments = null, employees = [], defaultManager, tasks, task = null, onSubmit, onCloseIssue, onReopenIssue, onSendRemark, onViewProof, liveKey, onClose }) {
  const editing = Boolean(task);
  const isClosed = Boolean(editing && (task.status === 'Closed' || task.closed || String(task.sourceStatus || '').toLowerCase() === 'closed'));
  const closedReviewOnly = isClosed && session.role !== 'Owner';
  const isAssignedOwner = editing && isOwnerOf(session, task);
  // Close: managers after reviewing proof, or the assigned owner after uploading proof.
  const canCloseFromForm = editing && !isClosed && (['Manager', 'Admin'].includes(session.role) || isAssignedOwner) && Boolean(onCloseIssue);
  // Reopen (proof not accepted): managers only, and always with a remark sent back to the owner.
  const canReopenFromForm = editing && isClosed && ['Manager', 'Admin'].includes(session.role) && Boolean(onReopenIssue);
  const recipients = useMemo(() => (editing ? remarkRecipients(task, session) : { side: null, names: [] }), [editing, task, session]);
  const canExchangeRemarks = editing && Boolean(onSendRemark) && Boolean(recipients.side);
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState('');
  const today = useMemo(() => startOfToday(), []);
  const isAdmin = session.role === 'Admin';
  const isOwner = session.role === 'Owner';
  const isPlatformManager = session.role === 'Manager';
  const pickTracker = true;
  const firstRef = useRef(null);
  const [form, setForm] = useState(() => (task ? {
    manager: task.manager, customer: task.customer || '', program: task.program || '', desc: task.desc || '',
    dept: task.dept && task.dept !== 'Unassigned' ? task.dept : '', owner: task.owner && task.owner !== 'Unassigned' ? task.owner : '',
    initialManager: task.initialManager || task.manager || '', member: task.member || '',
    start: task.start || '', due: task.due || '', next: task.next || '', remark: task.remark || '',
  } : {
    manager: isAdmin || session.role === 'Dept Head' ? defaultManager || managers[0] || '' : isPlatformManager ? session.name : mostUsedTracker(tasks) || managers[0] || '',
    customer: '', program: '', desc: '', dept: isOwner && session.dept && session.dept !== 'All' ? session.dept : '', owner: isOwner ? session.name : '',
    initialManager: defaultManager || (isPlatformManager ? session.name : managers[0]) || '', member: '',
    start: fmtDate(today), due: '', next: '', remark: '',
  }));
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const [otherDepartment, setOtherDepartment] = useState(false);
  const [otherProgram, setOtherProgram] = useState(false);
  const [proofFiles, setProofFiles] = useState([]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setDepartment = (e) => {
    const value = e.target.value;
    setOtherDepartment(value === '__other__');
    setForm((f) => ({ ...f, dept: value === '__other__' ? '' : value }));
  };
  const setOwner = (value) => setForm((f) => ({ ...f, owner: value }));

  // Owner suggestions come from the employee list; an older database without it falls back to the
  // names already used in the chosen tracker.
  const trackerTasks = useMemo(() => tasks.filter((t) => t.manager === form.manager), [tasks, form.manager]);
  const programs = useMemo(() => uniqueValues(tasks, 'program'), [tasks]);
  const managerOptions = useMemo(() => isPlatformManager ? [session.name].filter(Boolean) : [...new Set([...managers, form.manager].filter(Boolean))].sort(), [isPlatformManager, session.name, managers, form.manager]);
  const initialManagerOptions = useMemo(() => [...new Set([...managers, form.initialManager].filter(Boolean))].sort(), [managers, form.initialManager]);
  const owners = useMemo(() => [...new Set([...uniqueValues(trackerTasks, 'owner'), ...(task?.owner && task.owner !== 'Unassigned' ? [task.owner] : []), ...(isOwner && session.name ? [session.name] : [])])].sort(), [trackerTasks, task, isOwner, session.name]);
  const people = useMemo(() => (employees.length ? employees : owners.map((name) => ({ name }))), [employees, owners]);
  const unknown = employees.length ? unknownOwnerNames(form.owner, employees) : [];
  const depts = useMemo(
    () => [...new Set([...(departments || [...DEFAULT_DEPARTMENTS, ...trackerTasks.map((t) => normalizeDepartment(t.dept))]), ...(task?.dept ? [task.dept] : [])])].filter((d) => d && d !== 'Unassigned').sort(),
    [departments, trackerTasks, task],
  );

  // Same rules the dashboard uses, so the person sees how the new issue will be classified.
  const preview = useMemo(() => deriveTask({ due: form.due || null, closed: task?.closed || null }, today), [form.due, task, today]);

  useEffect(() => {
    firstRef.current?.focus();
    // Ignore an Escape already handled by an inner widget (owner suggestions, proof viewer).
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  async function submit(e, lifecycle = {}) {
    e.preventDefault();
    const validation = closedReviewOnly ? { errors: {}, issue: { ...form, remark: String(form.remark ?? '').trim() } } : validateNewIssue(form);
    const found = { ...validation.errors };
    const issue = validation.issue;
    const invalidProof = proofFiles.find((file) => validateFile(file));
    if (invalidProof) found.proof = `${invalidProof.name}: ${validateFile(invalidProof)}`;
    if (lifecycle.closeAfterSave && !(task.proofs || []).length && !proofFiles.length) found.proof = 'Attach proof before closing this issue.';
    let remarkMissing = false;
    if (lifecycle.reopenAfterSave) {
      remarkMissing = !message.trim();
      setMessageError(remarkMissing ? 'Write a remark telling the owner why the proof was not accepted.' : '');
    }
    setErrors(found);
    setServerError('');
    if (remarkMissing || Object.values(found).some(Boolean)) return;
    setBusy(true);
    try {
      const saved = await onSubmit(issue, proofFiles, lifecycle.reopenAfterSave ? { ...lifecycle, ownerRemark: message.trim() } : lifecycle);
      if (saved === false) setBusy(false);
    } catch (err) {
      setServerError(formatError(err));
      setBusy(false);
    }
  }

  async function sendRemark() {
    setMessageError('');
    setBusy(true);
    try {
      if (await onSendRemark(task, message)) setMessage('');
    } catch (err) {
      setMessageError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start md:items-center justify-center p-3 md:p-6 bg-black/70 overflow-auto" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <form onSubmit={submit} noValidate role="dialog" aria-modal="true" aria-labelledby="add-issue-title"
        className="glass-panel rounded-2xl w-full max-w-3xl p-5 md:p-6 my-auto">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 id="add-issue-title" className="font-display text-xl font-bold">{editing ? `Edit issue ${task.id}` : 'Add issue'}</h2>
            <p className="text-brembo-sub text-[12px] mt-1">{closedReviewOnly ? 'This issue is closed. Review the proof; if it is not valid, write a remark to the owner and reopen the issue to send it back.' : editing ? (isClosed ? 'As the assigned owner, you can update the closed issue details, add proof, and send a remark to your manager. Only the manager can reopen it.' : isAssignedOwner ? 'Upload your proof, then use "Upload & close". Your manager reviews the proof and can reopen the issue with a remark if it is not valid.' : 'Edit details until the issue is explicitly closed. The issue ID and tracker are locked; required fields cannot be cleared.') : 'The issue ID is assigned automatically.'} Status, RGY and escalation are calculated from the dates.</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="text-brembo-sub hover:text-brembo-ink"><X size={18} /></button>
        </div>

        {serverError && <div className="mb-4 text-xs px-3 py-2 rounded-md border bg-brembo-red/10 border-brembo-red/40 text-[#9b1224]" role="alert">{serverError}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {pickTracker ? (
            <Field label="Manager" required error={errors.manager} hint={isPlatformManager ? 'Platform Managers can create issues only in their own tracker.' : undefined}>
              <select value={form.manager} onChange={set('manager')} className={field} disabled={editing} ref={editing ? undefined : firstRef}>
                {!form.manager && <option value="">Select…</option>}
                {[...new Set([...(form.manager ? [form.manager] : []), ...managerOptions])].map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Tracker">
              <div className="px-2.5 py-2 text-[13px] text-brembo-sub border border-brembo-line rounded-md">{form.manager}</div>
            </Field>
          )}
          <Field label="Customer" error={errors.customer}>
            <input value={form.customer} onChange={set('customer')} className={field} placeholder="e.g. KTM" ref={pickTracker ? undefined : firstRef} disabled={closedReviewOnly} />
          </Field>
          <Field label="Program name" required error={errors.program}>
            <select value={otherProgram || (form.program && !programs.includes(form.program)) ? '__other__' : form.program} onChange={(e) => {
              const value = e.target.value;
              setOtherProgram(value === '__other__');
              setForm((f) => ({ ...f, program: value === '__other__' ? (programs.includes(f.program) ? '' : f.program) : value }));
            }} className={field} disabled={closedReviewOnly}>
              <option value="">Select…</option>
              {programs.map((program) => <option key={program} value={program}>{program}</option>)}
              <option value="__other__">Other…</option>
            </select>
            {(otherProgram || (form.program && !programs.includes(form.program))) && <input value={form.program} onChange={set('program')} className={`${field} mt-2`} placeholder="Enter program name" maxLength={120} disabled={closedReviewOnly} />}
          </Field>
          <Field label="Department" required error={errors.dept}>
            <select value={otherDepartment ? '__other__' : form.dept} onChange={setDepartment} className={field} disabled={closedReviewOnly}>
              <option value="">Select…</option>
              {depts.map((d) => <option key={d} value={d}>{d}</option>)}
              <option value="__other__">Other…</option>
            </select>
            {otherDepartment && (
              <input
                autoFocus
                value={form.dept}
                onChange={set('dept')}
                className={`${field} mt-2`}
                placeholder="Enter department"
                maxLength={100}
                disabled={closedReviewOnly}
              />
            )}
          </Field>
          <div className="md:col-span-2">
            <Field label="Issue description" required error={errors.desc}>
              <textarea value={form.desc} onChange={set('desc')} rows={3} maxLength={1000} className={field} disabled={closedReviewOnly} />
            </Field>
          </div>
          <Field label="Owner" required error={errors.owner} hint={unknown.length ? `Not on the employee list: ${unknown.join(', ')}. Check the spelling, or ask a manager to add them on the People page.` : isOwner ? 'Keep your name here so the issue stays in your list. Add a colleague with " / ".' : 'Pick from the employee list. Several owners can be separated with " / ".'}>
            <OwnerPicker value={form.owner} employees={people} onChange={setOwner} className={field} placeholder="Start typing a name…" disabled={closedReviewOnly} />
          </Field>
          <Field label="Initial Manager" hint="Defaults to the selected Manager; change it if the issue started with someone else.">
            <select value={form.initialManager} onChange={set('initialManager')} className={field} disabled={closedReviewOnly}>
              <option value="">Select…</option>
              {initialManagerOptions.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>
          <Field label="Resource Name" hint="Optional resource or contributor name.">
            <input value={form.member} onChange={set('member')} className={field} placeholder="Enter resource name" maxLength={160} disabled={closedReviewOnly} />
          </Field>
          <Field label="Start date" required error={errors.start}>
            <input type="date" value={form.start} onChange={set('start')} className={field} required disabled={closedReviewOnly} />
          </Field>
          <Field label="Target date" required error={errors.due} hint={editing && isOwner ? 'Set by your manager. Accept or reject it in the Task Register.' : undefined}>
            <input type="date" value={form.due} onChange={set('due')} className={field} required disabled={closedReviewOnly || (editing && isOwner)} />
          </Field>
          <Field label="Next date (revised target)" error={errors.next} hint="Must be no more than 7 days after the target date.">
            <input type="date" value={form.next} onChange={set('next')} className={field} disabled={closedReviewOnly} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Upload Proof" error={errors.proof} hint={editing ? 'Attach additional evidence to this issue (maximum 10 MB per file).' : 'Optional evidence can be attached now or later (maximum 10 MB per file).'}>
              {editing && (task.proofs || []).length > 0 && <div className="mb-2 flex flex-wrap gap-1.5 text-[11px] text-brembo-sub"><span className="w-full">Attached proof (select a file name to review):</span>{task.proofs.map((proof) => <button key={proof.id} type="button" onClick={() => onViewProof?.(task, proof)} disabled={!onViewProof} className="inline-flex items-center gap-1 rounded border border-brembo-line bg-white px-2 py-1 hover:border-brembo-red disabled:cursor-default"><Eye size={11} />{proof.name}</button>)}</div>}
                <label className={`inline-flex w-full items-center gap-2 bg-white border border-dashed border-[#8aae96] rounded-md px-3 py-2.5 text-[12.5px] text-brembo-sub ${closedReviewOnly ? 'cursor-not-allowed opacity-50' : 'hover:border-brembo-red cursor-pointer'}`}>
                  <Upload size={14} />
                  <span>{proofFiles.length ? `${proofFiles.length} file${proofFiles.length === 1 ? '' : 's'} selected` : 'Choose proof file(s)'}</span>
                  <input type="file" multiple accept={ACCEPT} className="sr-only" disabled={closedReviewOnly} onChange={(e) => {
                    const chosen = [...e.target.files];
                    setProofFiles((current) => [...current, ...chosen]);
                    setErrors((current) => ({ ...current, proof: '' }));
                    e.target.value = '';
                  }} />
                </label>
                {proofFiles.length > 0 && <ul className="mt-2 space-y-1">{proofFiles.map((file, index) => (
                  <li key={`${file.name}-${file.size}-${index}`} className="flex items-center justify-between gap-2 border border-brembo-line rounded-md bg-white px-2.5 py-1.5 text-[11.5px]">
                    <span className="flex items-center gap-1.5 min-w-0"><Paperclip size={11} className="shrink-0" /><span className="truncate">{file.name}</span></span>
                    <button type="button" onClick={() => setProofFiles((current) => current.filter((_, i) => i !== index))} aria-label={`Remove ${file.name}`} className="text-brembo-red"><X size={13} /></button>
                  </li>
                ))}</ul>}
            </Field>
          </div>
          <div className="md:col-span-2">
            <Field label="Remarks">
              <textarea value={form.remark} onChange={set('remark')} rows={2} className={field} />
            </Field>
          </div>
          {canExchangeRemarks && (
            <RemarkThread task={task} liveKey={liveKey} recipients={recipients} message={message} setMessage={setMessage}
              error={messageError} busy={busy} onSend={sendRemark} />
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-[12px] text-brembo-sub">
            {editing ? 'Will show as' : 'Will start as'} <b className="text-brembo-ink">{preview.status}</b> · Status <b className="text-brembo-ink">{getTaskStatusPresentation(preview).label}</b>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="border border-brembo-line rounded-full px-4 py-2 text-xs text-brembo-sub hover:text-brembo-ink bg-white">Cancel</button>
            {canReopenFromForm && <button type="button" onClick={(e) => submit(e, { reopenAfterSave: true })} disabled={busy} title="Proof not valid: reopen and send your remark back to the owner" className="inline-flex items-center gap-1.5 rounded-full border border-brembo-red px-4 py-2 text-xs font-bold text-brembo-red hover:bg-brembo-red/5 disabled:opacity-50"><RotateCcw size={13} />Proof invalid — reopen &amp; send remark</button>}
            {canCloseFromForm && <button type="button" onClick={(e) => submit(e, { closeAfterSave: true })} disabled={busy || (!(task.proofs || []).length && !proofFiles.length)} title={(task.proofs || []).length || proofFiles.length ? 'Save, upload selected proof, then close' : 'Upload proof before closing'} className="inline-flex items-center gap-1.5 rounded-full bg-brembo-green px-4 py-2 text-xs font-bold text-white hover:bg-[#146b38] disabled:cursor-not-allowed disabled:opacity-50"><Check size={13} />{isAssignedOwner ? 'Upload & close' : 'Save, upload & close'}</button>}
            <button type="submit" disabled={busy} className="bg-brembo-red hover:bg-[#ff3d56] disabled:opacity-60 text-white rounded-full px-5 py-2 text-xs font-bold">
              {busy ? (editing ? 'Saving…' : 'Adding…') : (editing ? 'Save changes' : 'Add issue')}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
