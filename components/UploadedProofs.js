'use client';
import { isOwnerOf } from '@/lib/owners';
import { useMemo, useState } from 'react';
import { Download, Eye, Paperclip } from 'lucide-react';
import { canRemoveProof, fmtSize } from '@/lib/proofs';
import { rowTone } from './rygb';
import { downloadProof } from './ProofViewer';


export default function UploadedProofs({ tasks, session, onViewProof, onRemoveProof, onSetRemark, onClose, onReopen, onError }) {
  const [q, setQ] = useState('');
  const rows = useMemo(() => {
    const all = tasks.flatMap((t) => (t.proofs || []).map((p) => ({ t, p })));
    const s = q.trim().toLowerCase();
    const list = s
      ? all.filter(({ t, p }) => [t.id, t.program, t.owner, t.dept, p.name, p.by].join(' ').toLowerCase().includes(s))
      : all;
    return list.sort((a, b) => String(b.p.at).localeCompare(String(a.p.at)));
  }, [tasks, q]);

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="text-[19px] font-bold mb-1">Uploaded Proofs</h1>
          <p className="text-brembo-sub text-[13px]">{rows.length} file{rows.length === 1 ? '' : 's'} attached to issues in this view. Click View to open a file without leaving the platform.</p>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search issue, owner, file…" className="bg-white border border-brembo-line rounded-full px-4 py-2 text-[12.5px] w-full md:w-72 shadow-card" />
      </div>
      <div className="border border-brembo-line rounded-lg overflow-auto bg-white shadow-defined">
        <table className="w-full text-[12.5px] border-collapse">
          <thead>
            <tr className="bg-brembo-panel2 text-brembo-sub">
              {['Issue ID', 'Program', 'Owner', 'File', 'Size', 'Uploaded by', 'Uploaded on', 'Remarks', ''].map((h) => (
                <th key={h} className="text-left font-semibold px-2.5 py-2 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map(({ t, p }) => (
                <tr key={p.id} className={`border-t border-brembo-line ${rowTone(t)}`}>
                  <td className="px-2.5 py-2 whitespace-nowrap">{t.id}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap">{t.program}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap">{t.owner}</td>
                  <td className="px-2.5 py-2"><span className="inline-flex items-center gap-1.5"><Paperclip size={11} />{p.name}</span></td>
                  <td className="px-2.5 py-2 whitespace-nowrap">{fmtSize(p.size)}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap">{p.by || '—'}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap">{p.at ? String(p.at).slice(0, 10) : '—'}</td>
                  <td className="px-2.5 py-2 min-w-[180px]">
                    {t.status !== 'Closed' && (session.role === 'Manager' || session.role === 'Admin' || session.role === 'Owner') ? <input key={`${t.id}-${t.remark || ''}`} defaultValue={t.remark || ''} placeholder="Add remark" onBlur={(e) => e.target.value !== (t.remark || '') && onSetRemark(t.id, e.target.value)} className="bg-white border border-brembo-line rounded px-2 py-1 text-[11.5px] w-[170px]" /> : t.remark || '—'}
                  </td>
                  <td className="px-2.5 py-2 whitespace-nowrap">
                    <button type="button" onClick={() => onViewProof(t, p)} title={`View ${p.name}`} className="bg-brembo-red/10 text-brembo-red hover:bg-brembo-red/20 rounded-full px-2.5 py-1 text-[11px] font-bold inline-flex items-center gap-1 mr-1.5"><Eye size={12} /> View</button>
                    <button type="button" onClick={() => downloadProof(p).catch((e) => onError(e.message))} title="Download" className="bg-brembo-panel2 border border-brembo-line rounded-full p-1.5 inline-flex"><Download size={12} /></button>
                    {canRemoveProof(session, t, p) && <button type="button" onClick={() => onRemoveProof(t.id, p)} title="Remove proof" aria-label={`Remove proof ${p.name}`} className="bg-brembo-panel2 border border-brembo-line rounded-full p-1.5 inline-flex ml-1.5 text-brembo-red">×</button>}
                    {(session.role === 'Manager' || session.role === 'Admin' || isOwnerOf(session, t)) && (t.status === 'Closed' ? (session.role !== 'Owner' && <button onClick={() => onReopen(t.id)} title="Reopen and send back to owner" className="bg-brembo-panel2 border border-brembo-line rounded-full p-1.5 inline-flex ml-1.5">↶</button>) : <button onClick={() => onClose(t.id)} title="Change status to closed" className="bg-brembo-panel2 border border-brembo-line rounded-full p-1.5 inline-flex ml-1.5">✓</button>)}
                  </td>
                </tr>
              ))
            ) : (
              <tr><td colSpan={9} className="px-2.5 py-3 text-brembo-sub">No proofs uploaded yet in this view.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
