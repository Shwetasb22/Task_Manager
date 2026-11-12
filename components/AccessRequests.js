'use client';
import { useState } from 'react';
import { Check, ShieldCheck, X } from 'lucide-react';

const input = 'bg-white border border-brembo-line rounded-md px-2 py-1.5 text-[12.5px] focus:outline-none focus:border-brembo-red';

// Admin only: people who asked for Manager access. Approving a manager needs their tracker name.
export default function AccessRequests({ requests, trackers = [], onReview }) {
  const [tracker, setTracker] = useState({}); // request id -> tracker name typed
  const [busy, setBusy] = useState(null);

  if (!requests.length) return null;

  async function decide(request, approve) {
    if (!approve && !window.confirm(`Decline ${request.name}'s request? They will not be able to enter.`)) return;
    setBusy(request.id);
    try {
      await onReview(request, approve, tracker[request.id] ?? request.name);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="bg-white border border-brembo-red/40 rounded-lg p-3 mb-4 shadow-card" aria-label="Access requests">
      <h2 className="flex items-center gap-2 text-[14px] font-bold text-brembo-ink mb-1">
        <ShieldCheck size={16} className="text-brembo-red" /> Access requests <span className="rounded-full bg-brembo-red text-white px-2 text-[11px] leading-5">{requests.length}</span>
      </h2>
      <p className="text-[12px] text-brembo-sub mb-3 max-w-3xl">
        These people asked to be a Manager. Check that the request is genuine (for example with their boss), name the tracker they will run, then approve. Owners do not appear here because they are approved when they sign up.
      </p>
      <ul className="flex flex-col gap-2">
        {requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-end gap-3 border border-brembo-line rounded-md p-2.5">
            <div className="min-w-[200px] flex-1">
              <b className="block text-[13px] text-brembo-ink">{r.name}</b>
              <span className="text-[11.5px] text-brembo-sub">{r.email}{r.department ? ` · ${r.department}` : ''}</span>
              <span className="block text-[11px] text-brembo-sub">Asked for: <b className="text-brembo-ink capitalize">{r.requested_role || 'manager'}</b> · {r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}</span>
            </div>
            {(r.requested_role || 'manager') === 'manager' && (
              <label className="flex flex-col text-[11px] uppercase tracking-wide text-brembo-sub gap-1">Tracker name
                <input list="access-trackers" value={tracker[r.id] ?? r.name} onChange={(e) => setTracker({ ...tracker, [r.id]: e.target.value })} className={`${input} w-52`} aria-label={`Tracker name for ${r.name}`} />
              </label>
            )}
            <div className="flex gap-2">
              <button type="button" disabled={busy === r.id} onClick={() => decide(r, true)} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold border bg-brembo-red border-brembo-red text-white disabled:opacity-50"><Check size={14} /> Approve</button>
              <button type="button" disabled={busy === r.id} onClick={() => decide(r, false)} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold border border-brembo-line text-brembo-sub hover:border-brembo-red hover:text-brembo-red disabled:opacity-50"><X size={14} /> Decline</button>
            </div>
          </li>
        ))}
      </ul>
      <datalist id="access-trackers">{trackers.map((t) => <option key={t} value={t} />)}</datalist>
    </section>
  );
}
