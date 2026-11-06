'use client';
import { useState } from 'react';
import { store, usingSupabase } from '@/lib/store';
import { QUICK_LOGINS } from '@/lib/data';
import { ArrowRight, Eye, EyeOff, Sparkles, UserRound } from 'lucide-react';
import Logo from './Logo';

const OWNER_EMAIL_PATTERN = /^[^\s@]+@bremboindia\.com$/i;

export default function AuthScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerDept, setOwnerDept] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState('login');
  const [msg, setMsg] = useState(null); // {type:'error'|'ok', text}

  async function submit(e) {
    e.preventDefault();
    setMsg(null);

    if (mode === 'signup') {
      const name = ownerName.trim();
      const dept = ownerDept.trim();
      if (!name) {
        setMsg({ type: 'error', text: 'Enter the owner name before creating the account.' });
        return;
      }
      if (!email.trim()) {
        setMsg({ type: 'error', text: 'Enter the owner Outlook ID.' });
        return;
      }
      if (!OWNER_EMAIL_PATTERN.test(email.trim())) {
        setMsg({ type: 'error', text: 'Owner sign-up is only available with an @bremboindia.com email address.' });
        return;
      }
      if (password.length < 8) {
        setMsg({ type: 'error', text: 'Password must be at least 8 characters.' });
        return;
      }
      if (password !== confirmPassword) {
        setMsg({ type: 'error', text: 'Passwords do not match.' });
        return;
      }
      if (!usingSupabase) {
        setMsg({ type: 'error', text: 'Owner sign-up requires the connected Brembo Supabase service.' });
        return;
      }

      setBusy(true);
      try {
        const session = await store.signUp({ name, email: email.trim(), password, department: dept || 'Unassigned' });
        onLogin(session);
        setEmail('');
        setPassword('');
        setConfirmPassword('');
        setOwnerName('');
        setOwnerDept('');
      } catch (err) {
        const msgText = /rate limit|too many/i.test(err?.message || '')
          ? 'Supabase email rate limit reached. Turn off email confirmation for this project or create owner accounts from the Supabase admin panel so signup does not flood email traffic.'
          : err.message;
        setMsg({ type: 'error', text: msgText });
      } finally {
        setBusy(false);
      }
      return;
    }

    if (!usingSupabase) {
      return onLogin({ name: 'Admin', display: 'Admin', role: 'Admin', dept: 'All' });
    }

    setBusy(true);
    try {
      onLogin(await store.signIn(email, password));
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    setMsg(null);
    if (!email.trim()) return setMsg({ type: 'error', text: 'Enter your Outlook ID above first.' });
    try {
      await store.resetPassword(email);
      setMsg({ type: 'ok', text: 'If that ID exists, a password-reset link has been emailed.' });
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 md:p-8 bg-brembo-paper"
      style={{ backgroundImage: 'radial-gradient(700px 500px at 8% 10%, rgba(200,16,46,.1), transparent 60%), radial-gradient(600px 500px at 100% 90%, rgba(217,163,26,.08), transparent 60%)' }}>
      <div className="w-full max-w-5xl grid md:grid-cols-[1fr_390px] glass-panel rounded-2xl overflow-hidden shadow-2xl">
        <div className="hidden md:flex flex-col justify-between p-10 bg-gradient-to-br from-[#c8102e] via-[#a50e26] to-[#7a0c1e] relative overflow-hidden text-white">
          <div className="absolute -right-20 -bottom-24 w-72 h-72 rounded-full border-[28px] border-white/5" />
          <div>
            <Logo size={40} priority />
            <div className="mt-20 max-w-sm">
              <div className="flex items-center gap-2 text-[#ff9aaa] text-xs uppercase tracking-[.18em] font-bold mb-4"><Sparkles size={14} /> Operations intelligence</div>
              <h1 className="font-display text-5xl font-bold leading-[1.05]">Make every issue visible.</h1>
              <p className="text-white/65 text-sm leading-6 mt-5">One command center for live RGY health, ownership, proofs, and program momentum.</p>
            </div>
          </div>
          <div className="text-white/50 text-xs flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-brembo-green" /> {usingSupabase ? 'Secure sign-in' : 'Demo mode — data stays in this browser'}</div>
        </div>
        <div className="bg-white">
          <form onSubmit={submit} className="px-7 pt-7 pb-7 flex flex-col gap-3">
            <div className="md:hidden"><Logo size={40} priority /></div>
            <div className="flex items-center gap-2 rounded-full border border-brembo-line bg-brembo-panel2 p-1 mb-1">
              <button type="button" onClick={() => setMode('login')} className={`flex-1 rounded-full px-3 py-2 text-[11px] font-semibold transition ${mode === 'login' ? 'bg-brembo-red text-white' : 'text-brembo-sub'}`}>
                Log in
              </button>
              <button type="button" onClick={() => setMode('signup')} className={`flex-1 rounded-full px-3 py-2 text-[11px] font-semibold transition ${mode === 'signup' ? 'bg-brembo-red text-white' : 'text-brembo-sub'}`}>
                Sign up
              </button>
            </div>
            <h2 className="font-display text-lg font-bold mb-1">{mode === 'signup' ? 'Owner sign up' : 'Team member log in'}</h2>
            {mode === 'login' ? (
              usingSupabase ? (
                <>
                  <Field label="Outlook ID"><input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@brembo.com" className="input" /></Field>
                  <Field label="Password">
                    <div className="relative">
                      <input type={showPassword ? 'text' : 'password'} required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="input pr-10" />
                      <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute inset-y-0 right-3 flex items-center text-brembo-sub hover:text-brembo-ink" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                        {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    </div>
                  </Field>
                  <button type="button" onClick={forgot} className="self-end text-xs text-brembo-sub hover:text-brembo-red">Forgot password?</button>
                </>
              ) : (
                <>
                  <div className="text-[11.5px] text-brembo-sub bg-brembo-panel2 border border-brembo-line rounded-lg px-3 py-2">
                    Demo mode: no server is connected, so anything you change stays in this browser only. Pick a demo user below to start the app on the login flow.
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {QUICK_LOGINS.map((q) => (
                      <button type="button" key={q.name} onClick={() => onLogin({ ...q, display: q.name })} className="text-left bg-brembo-panel2 border border-brembo-line hover:border-brembo-red hover:bg-[#fdecef] rounded-lg p-2.5 text-xs">
                        <span className="flex items-center gap-2 font-semibold"><UserRound size={13} className="text-brembo-red" />{q.name}</span>
                        <small className="block text-brembo-sub text-[10.5px]">{q.role}</small>
                      </button>
                    ))}
                  </div>
                </>
              )
            ) : (
              <>
                <Field label="Full name"><input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="e.g. Yogita Salunkhe" className="input" /></Field>
                <p className="-mt-2 text-[11px] text-brembo-sub">Enter your full name. You will see every issue assigned to you in any manager&apos;s tracker, whether it is written as “Yogita”, “Yogita Salunke” or “Salunkhe Yogita”.</p>
                <Field label="Department"><input value={ownerDept} onChange={(e) => setOwnerDept(e.target.value)} placeholder="e.g. Maintenance / QA" className="input" /></Field>
                <Field label="Outlook ID"><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@brembo.com" className="input" /></Field>
                <Field label="Password">
                  <div className="relative">
                    <input type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="input pr-10" />
                    <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute inset-y-0 right-3 flex items-center text-brembo-sub hover:text-brembo-ink" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </Field>
                <Field label="Confirm password"><input type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="••••••••" className="input" /></Field>
              </>
            )}
            {msg && <div className={`text-xs rounded-lg px-3 py-2 ${msg.type === 'error' ? 'bg-brembo-red/10 text-[#9b1224]' : 'bg-brembo-green/10 text-[#146b38]'}`}>{msg.text}</div>}
            <button type="submit" disabled={busy} className="mt-1 bg-brembo-red hover:bg-[#ff3d56] disabled:opacity-60 text-white font-bold text-sm py-3 rounded-lg flex items-center justify-center gap-2 shadow-[0_8px_22px_rgba(229,45,69,.25)]">
              {busy ? 'Please wait…' : mode === 'signup' ? 'Create owner account' : 'Enter command center'} <ArrowRight size={16} />
            </button>
            {mode === 'login' && usingSupabase && <p className="text-[11px] text-brembo-sub mt-1">No account? Use the Sign up tab for owner onboarding.</p>}
          </form>
        </div>
      </div>
      <style jsx global>{`
        .input { width: 100%; background: #ffffff; border: 1px solid #e4d9dc; color: #1c1418; padding: 10px 11px; border-radius: 8px; font-size: 13.5px; }
      `}</style>
    </div>
  );
}

export function SetPassword({ onDone }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState(null);
  async function submit(e) {
    e.preventDefault();
    if (pw.length < 8) return setMsg('Use at least 8 characters.');
    if (pw !== pw2) return setMsg('Passwords do not match.');
    try {
      await store.updatePassword(pw);
      onDone();
    } catch (err) {
      setMsg(err.message);
    }
  }
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-brembo-paper">
      <form onSubmit={submit} className="glass-panel rounded-2xl p-7 w-full max-w-sm flex flex-col gap-3">
        <Logo size={40} priority />
        <h2 className="font-display text-lg font-bold">Set a new password</h2>
        <Field label="New password"><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} className="input" autoComplete="new-password" /></Field>
        <Field label="Confirm password"><input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} className="input" autoComplete="new-password" /></Field>
        {msg && <div className="text-xs text-[#9b1224]">{msg}</div>}
        <button type="submit" className="bg-brembo-red hover:bg-[#ff3d56] text-white font-bold text-sm py-2.5 rounded-lg">Save password</button>
      </form>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="field">
      <label className="block text-xs text-brembo-sub mb-1">{label}</label>
      {children}
    </div>
  );
}
