'use client';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Download, FileText, X } from 'lucide-react';
import { store } from '@/lib/store';
import { fmtSize, kindFor } from '@/lib/proofs';

// Shared by the viewer modal and the proofs list.
export async function downloadProof(proof) {
  const url = await store.getProofUrl(proof, { download: true });
  const a = document.createElement('a');
  a.href = url;
  a.download = proof.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (url.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export default function ProofViewer({ proof, task, onClose }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(null);
  const [text, setText] = useState(null);
  const kind = kindFor(proof);

  useEffect(() => {
    let alive = true;
    let made = null;
    setUrl(null); setErr(null); setText(null);
    store.getProofUrl(proof)
      .then(async (u) => {
        made = u;
        if (!alive) return;
        setUrl(u);
        if (kind === 'text') {
          const r = await fetch(u);
          const t = await r.text();
          if (alive) setText(t.length > 200000 ? t.slice(0, 200000) + '\n… (truncated — download for the full file)' : t);
        }
      })
      .catch((e) => alive && setErr(e.message));
    return () => {
      alive = false;
      if (made && made.startsWith('blob:')) URL.revokeObjectURL(made);
    };
  }, [proof, kind]);

  useEffect(() => {
    // The viewer sits on top of other dialogs (e.g. the Edit issue window): handle Escape first
    // (capture phase) and mark it handled so only the viewer closes.
    const onKey = (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-3 md:p-8" onClick={onClose}>
      <div className="glass-panel rounded-xl w-full max-w-5xl max-h-full flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-brembo-line">
          <div className="min-w-0">
            <div className="font-semibold text-[14px] truncate">{proof.name}</div>
            <div className="text-[11px] text-brembo-sub truncate">
              {task ? `${task.id} · ${task.program} · ${task.owner}` : ''} · {fmtSize(proof.size)}
              {proof.by ? ` · uploaded by ${proof.by}` : ''}{proof.at ? ` on ${String(proof.at).slice(0, 10)}` : ''}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => downloadProof(proof).catch((e) => setErr(e.message))} className="bg-brembo-red hover:bg-[#ff3d56] text-white rounded-full px-3 py-1.5 text-xs font-bold flex items-center gap-1.5"><Download size={13} /> Download</button>
            <button onClick={onClose} aria-label="Close" className="bg-brembo-panel2 border border-brembo-line rounded-full p-1.5"><X size={15} /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-3 flex items-center justify-center min-h-[240px] bg-brembo-panel2">
          {err && <div className="text-sm text-[#9b1224]">Could not open this file: {err}</div>}
          {!err && !url && <div className="text-sm text-brembo-sub">Loading…</div>}
          {!err && url && kind === 'image' && <Image src={url} alt={proof.name} width={1200} height={900} unoptimized className="max-h-[72vh] max-w-full object-contain rounded" />}
          {!err && url && kind === 'pdf' && <iframe src={url} title={proof.name} className="w-full h-[72vh] rounded bg-white" />}
          {!err && url && kind === 'text' && <pre className="w-full max-h-[72vh] overflow-auto text-[12px] whitespace-pre-wrap font-mono self-start">{text ?? 'Loading…'}</pre>}
          {!err && url && kind === 'other' && (
            <div className="text-center text-brembo-sub text-sm">
              <FileText size={40} className="mx-auto mb-3 opacity-60" />
              Preview isn&apos;t available for this file type.<br />Use Download to open it in its own application.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
