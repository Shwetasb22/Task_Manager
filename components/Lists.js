'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Eye, EyeOff, GitMerge, Pencil, Plus, Wand2 } from 'lucide-react';
import { DEPARTMENT_ALIASES } from '@/lib/departments';

const input = 'bg-white border border-brembo-line rounded-md px-2 py-1 text-[12.5px] focus:outline-none focus:border-brembo-red';
const btn = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-bold border disabled:opacity-40';
const th = 'text-left px-3 py-2 text-[11px] uppercase tracking-wide text-brembo-sub font-semibold border-b border-brembo-line';
const td = 'px-3 py-2 border-b border-brembo-line align-middle';

// Admin page: the trackers and departments the app offers. Renaming or merging changes every issue
// at once (and is recorded in each issue's History); hiding only removes an entry from the pickers.
export default function Lists({ store, onChanged, onError, onDone }) {
  const [lists, setLists] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [rename, setRename] = useState({}); // tracker -> new name
  const [mergeTo, setMergeTo] = useState({}); // department -> target code
  const [newDept, setNewDept] = useState({ code: '', name: '' });
  const [archivable, setArchivable] = useState(null); // issues closed over a year ago and not archived yet

  const load = useCallback(() => {
    if (store.archiveCandidates) store.archiveCandidates(365).then(setArchivable).catch(() => {});
    return store.listLists().then((l) => { setLists(l); setErr(null); }).catch((e) => setErr(e.message));
  }, [store]);
  useEffect(() => { load(); }, [load]);

  const codes = useMemo(() => (lists ? lists.departments.map((d) => d.code) : []), [lists]);
  // Old spellings the app already knows how to read (lib/departments.js), offered as one-click merges.
  const suggestions = useMemo(() => (lists ? lists.departments
    .map((d) => ({ from: d.code, to: DEPARTMENT_ALIASES[d.code] || DEPARTMENT_ALIASES[d.code.toUpperCase()], issues: d.issues }))
    .filter((s) => s.to && s.to !== s.from) : []), [lists]);

  async function run(fn, done) {
    setBusy(true);
    try {
      const result = await fn();
      await load();
      if (done) onDone(done(result));
      return true;
    } catch (e) {
      onError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function renameTracker(t) {
    const to = (rename[t.name] || '').trim();
    if (!to || to === t.name) return;
    const merging = lists.trackers.some((x) => x.name === to);
    const question = merging
      ? `Merge tracker "${t.name}" into "${to}"? Its ${t.issues} issue(s) move to "${to}" and "${t.name}" is removed from the list.`
      : `Rename tracker "${t.name}" to "${to}"? Its ${t.issues} issue(s) and its manager follow.`;
    if (!window.confirm(question)) return;
    if (await run(() => store.renameTracker(t.name, to), (n) => `${merging ? 'Merged' : 'Renamed'} "${t.name}" to "${to}": ${n} issue(s) moved.`)) {
      setRename((r) => ({ ...r, [t.name]: '' }));
      onChanged();
    }
  }

  async function mergeDept(from, to) {
    if (!to || to === from) return;
    const d = lists.departments.find((x) => x.code === from);
    if (!window.confirm(`Merge department "${from}" into "${to}"? ${d ? d.issues : 0} issue(s) change to "${to}" and "${from}" is removed from the list.`)) return;
    if (await run(() => store.mergeDepartment(from, to), (n) => `Department "${from}" merged into "${to}": ${n} issue(s) changed.`)) onChanged();
  }

  if (err) return <div className="bg-white border border-brembo-line rounded-lg px-4 py-3 text-[13px] text-brembo-sub shadow-card">{err}</div>;
  if (!lists) return <div className="text-brembo-sub text-[13px]">Loading lists…</div>;

  return (
    <div className="max-w-[1000px]">
      <h1 className="text-[19px] font-bold mb-1 text-brembo-ink">Lists</h1>
      <p className="text-brembo-sub text-[13px] mb-4 max-w-3xl">
        The trackers and departments the app offers. Renaming or merging changes every issue at once and is recorded in each issue&apos;s History. Hiding only removes an entry from the pickers; its issues stay as they are.
      </p>

      <section className="bg-white border border-brembo-line rounded-lg shadow-card mb-6" aria-label="Trackers">
        <h2 className="px-3 pt-3 pb-1 font-semibold text-[14px]">Trackers</h2>
        <table className="w-full text-[12.5px] border-collapse">
          <thead><tr><th className={th}>Tracker</th><th className={th}>Issues</th><th className={th}>Offered</th><th className={th}>Rename or merge into</th></tr></thead>
          <tbody>
            {lists.trackers.map((t) => {
              const to = (rename[t.name] || '').trim();
              const merging = to && to !== t.name && lists.trackers.some((x) => x.name === to);
              return (
                <tr key={t.name} className={t.active ? '' : 'text-brembo-sub'}>
                  <td className={td}><b>{t.name}</b></td>
                  <td className={td}>{t.open} open · {t.issues} total</td>
                  <td className={td}>
                    <button type="button" disabled={busy} onClick={() => run(() => store.setTrackerActive(t.name, !t.active)).then((ok) => ok && onChanged())} className={`${btn} border-brembo-line`} aria-label={`${t.active ? 'Hide' : 'Show'} tracker ${t.name}`}>
                      {t.active ? <><Eye size={12} /> Shown</> : <><EyeOff size={12} /> Hidden</>}
                    </button>
                  </td>
                  <td className={td}>
                    <div className="flex items-center gap-2">
                      <input value={rename[t.name] || ''} onChange={(e) => setRename((r) => ({ ...r, [t.name]: e.target.value }))} list="lists-trackers" placeholder="New name" className={`${input} w-48`} aria-label={`New name for ${t.name}`} />
                      <button type="button" disabled={busy || !to || to === t.name} onClick={() => renameTracker(t)} className={`${btn} border-brembo-red text-brembo-red`}>
                        {merging ? <><GitMerge size={12} /> Merge</> : <><Pencil size={12} /> Rename</>}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <datalist id="lists-trackers">{lists.trackers.map((t) => <option key={t.name} value={t.name} />)}</datalist>
        <p className="px-3 py-2 text-[11.5px] text-brembo-sub">A new tracker appears when you give someone a manager name, or when an admin files an issue under a new tracker name.</p>
      </section>

      <section className="bg-white border border-brembo-line rounded-lg shadow-card" aria-label="Departments">
        <h2 className="px-3 pt-3 pb-1 font-semibold text-[14px]">Departments</h2>
        {suggestions.length > 0 && (
          <div className="mx-3 my-2 rounded-md border border-brembo-red/30 bg-[#fff6f7] px-3 py-2 text-[12.5px]" role="region" aria-label="Suggested merges">
            <div className="font-semibold mb-1 flex items-center gap-1.5"><Wand2 size={13} /> Old spellings that belong to a standard department</div>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <button key={s.from} type="button" disabled={busy} onClick={() => mergeDept(s.from, s.to)} className={`${btn} border-brembo-line bg-white`}>
                  {s.from} → {s.to} ({s.issues})
                </button>
              ))}
            </div>
          </div>
        )}
        <table className="w-full text-[12.5px] border-collapse">
          <thead><tr><th className={th}>Code</th><th className={th}>Full name</th><th className={th}>Issues</th><th className={th}>Offered</th><th className={th}>Merge into</th></tr></thead>
          <tbody>
            {lists.departments.map((d) => (
              <tr key={d.code} className={d.active ? '' : 'text-brembo-sub'}>
                <td className={td}><b>{d.code}</b></td>
                <td className={td}>
                  <input defaultValue={d.name || ''} placeholder="Add full name" className={`${input} w-48`} aria-label={`Full name of ${d.code}`}
                    onBlur={(e) => { if ((e.target.value.trim() || null) !== (d.name || null)) run(() => store.saveDepartment({ ...d, name: e.target.value })); }} />
                </td>
                <td className={td}>{d.open} open · {d.issues} total</td>
                <td className={td}>
                  <button type="button" disabled={busy} onClick={() => run(() => store.saveDepartment({ ...d, active: !d.active })).then((ok) => ok && onChanged())} className={`${btn} border-brembo-line`} aria-label={`${d.active ? 'Hide' : 'Show'} department ${d.code}`}>
                    {d.active ? <><Eye size={12} /> Shown</> : <><EyeOff size={12} /> Hidden</>}
                  </button>
                </td>
                <td className={td}>
                  <div className="flex items-center gap-2">
                    <select value={mergeTo[d.code] || ''} onChange={(e) => setMergeTo((m) => ({ ...m, [d.code]: e.target.value }))} className={input} aria-label={`Merge ${d.code} into`}>
                      <option value="">Choose…</option>
                      {codes.filter((c) => c !== d.code).map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button type="button" disabled={busy || !mergeTo[d.code]} onClick={() => mergeDept(d.code, mergeTo[d.code])} className={`${btn} border-brembo-red text-brembo-red`}><GitMerge size={12} /> Merge</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form className="flex flex-wrap items-center gap-2 px-3 py-3" onSubmit={(e) => { e.preventDefault(); if (newDept.code.trim()) run(() => store.saveDepartment({ ...newDept, active: true }), () => `Department "${newDept.code.trim()}" added.`).then((ok) => { if (ok) { setNewDept({ code: '', name: '' }); onChanged(); } }); }}>
          <input value={newDept.code} onChange={(e) => setNewDept((d) => ({ ...d, code: e.target.value.toUpperCase() }))} placeholder="Code, e.g. PUR" className={`${input} w-32`} aria-label="New department code" />
          <input value={newDept.name} onChange={(e) => setNewDept((d) => ({ ...d, name: e.target.value }))} placeholder="Full name (optional)" className={`${input} w-56`} aria-label="New department name" />
          <button type="submit" disabled={busy || !newDept.code.trim() || codes.includes(newDept.code.trim())} className={`${btn} border-brembo-line`}><Plus size={12} /> Add department</button>
        </form>
      </section>

      {archivable !== null && (
        <section className="bg-white border border-brembo-line rounded-lg shadow-card mt-6 px-3 py-3 text-[12.5px]" aria-label="Archive">
          <h2 className="font-semibold text-[14px] mb-1 flex items-center gap-1.5"><Archive size={14} /> Archive</h2>
          <p className="text-brembo-sub mb-2 max-w-3xl">Issues closed more than a year ago are archived every Sunday night: they stay in the database and in History but are not downloaded when the app opens. Anyone can still see them with &quot;Show archived&quot; in the Task Register, and reopening one brings it back.</p>
          <div className="flex items-center gap-3">
            <span>{archivable} issue{archivable === 1 ? '' : 's'} closed more than a year ago {archivable === 1 ? 'is' : 'are'} not archived yet.</span>
            <button type="button" disabled={busy || !archivable} onClick={() => window.confirm(`Archive ${archivable} issue(s) closed more than a year ago?`) && run(() => store.archiveNow(365), (n) => `${n} issue(s) archived.`).then((ok) => ok && onChanged())} className={`${btn} border-brembo-line`}>
              <Archive size={12} /> Archive now
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
