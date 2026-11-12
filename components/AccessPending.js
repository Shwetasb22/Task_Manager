'use client';
import { useEffect, useState } from 'react';
import { Clock, LogOut, RefreshCw, ShieldX } from 'lucide-react';
import Logo from './Logo';

// Shown instead of the app while an Admin has not approved this person yet (or has declined them).
// It re-checks by itself every 30 seconds and whenever the tab is opened again.
export default function AccessPending({ session, onRecheck, onLogout }) {
  const declined = session.access === 'rejected';
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState('');

  async function check(manual) {
    setChecking(true);
    try {
      const approved = await onRecheck();
      if (!approved && manual) setNote('Still waiting. You will be let in as soon as an Admin approves you.');
    } catch {
      if (manual) setNote('Could not check right now. Try again in a moment.');
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (declined) return undefined;
    const timer = setInterval(() => check(false), 30000);
    const onFocus = () => check(false);
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(timer); window.removeEventListener('focus', onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declined]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-brembo-paper">
      <div className="glass-panel rounded-2xl p-7 w-full max-w-md flex flex-col gap-3">
        <Logo size={40} priority />
        <div className={`flex items-center gap-2 font-display text-lg font-bold ${declined ? 'text-[#9b1224]' : 'text-brembo-ink'}`}>
          {declined ? <ShieldX size={20} /> : <Clock size={20} className="text-brembo-red" />}
          {declined ? 'Access request declined' : 'Waiting for approval'}
        </div>
        <p className="text-[13px] text-brembo-sub leading-6">
          {declined
            ? <>Your request for Manager access was not approved. If this is a mistake, contact an Admin.</>
            : <>Hello {session.display || session.name}. Your <b className="text-brembo-ink">Manager</b> request has been sent. An Admin has to approve it and set up your tracker before you can enter. This page checks automatically, so you can leave it open.</>}
        </p>
        <div className="text-[11.5px] text-brembo-sub bg-brembo-panel2 border border-brembo-line rounded-lg px-3 py-2">{session.email}</div>
        {note && <div className="text-xs text-brembo-sub">{note}</div>}
        {!declined && (
          <button type="button" onClick={() => check(true)} disabled={checking} className="bg-brembo-red hover:bg-[#ff3d56] disabled:opacity-60 text-white font-bold text-sm py-2.5 rounded-lg flex items-center justify-center gap-2">
            <RefreshCw size={14} className={checking ? 'animate-spin' : ''} /> {checking ? 'Checking…' : 'Check again'}
          </button>
        )}
        <button type="button" onClick={onLogout} className="border border-brembo-line hover:border-brembo-red hover:text-brembo-red rounded-lg px-2.5 py-2 text-[12px] text-brembo-sub flex items-center justify-center gap-2">
          <LogOut size={13} /> Log out
        </button>
      </div>
    </div>
  );
}
