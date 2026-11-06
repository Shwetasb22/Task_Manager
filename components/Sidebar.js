'use client';
import Logo from './Logo';
import { Archive, BarChart3, BookOpenCheck, Contact, FileText, ListChecks, Sunrise, ClipboardCheck, FileSpreadsheet, LogOut, UsersRound } from 'lucide-react';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'morning', label: 'Morning Update', icon: Sunrise },
  { id: 'register', label: 'Task Register', icon: ClipboardCheck },
  { id: 'closed', label: 'Closed Issues', icon: Archive },
  { id: 'report', label: 'Weekly Report', icon: FileText },
  { id: 'proofs', label: 'Uploaded Proofs', icon: FileSpreadsheet },
  { id: 'people', label: 'People', icon: Contact, roles: ['Admin', 'Dept Head', 'Manager'] },
  { id: 'lists', label: 'Lists', icon: ListChecks, roles: ['Admin'] },
  { id: 'sop', label: 'SOP', icon: BookOpenCheck },
];

export default function Sidebar({ session, activeView, onNavigate, managers, teamMembers = managers, viewAsManager, onSelectManager, onLogout, hiddenTabs = [], badges = {}, open }) {
  return (
    <aside
      className={`print:hidden w-[220px] shrink-0 bg-white border-r border-brembo-line shadow-[8px_0_24px_rgba(28,20,24,0.04)] flex flex-col p-3 overflow-y-auto fixed md:static inset-y-0 left-0 z-30 transition-transform ${
        open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      }`}
    >
      <div className="px-1.5">
        <Logo size={36} />
      </div>
      <nav className="mt-2 flex flex-col gap-0.5">
        {TABS.filter((t) => !hiddenTabs.includes(t.id) && (!t.roles || (t.roles.includes(session.role) && !session.pending))).map((t) => (
          <button
            key={t.id}
            onClick={() => onNavigate(t.id)}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded text-[13px] font-semibold text-left ${
              activeView === t.id ? 'bg-brembo-red text-white shadow-card' : 'text-brembo-sub hover:bg-brembo-panel2 hover:text-brembo-ink'
            }`}
          >
            <t.icon size={15} className="opacity-75 shrink-0" />
            {t.label}
            {badges[t.id] > 0 && (
              <span
                title={`${badges[t.id]} escalation${badges[t.id] === 1 ? '' : 's'} need your action`}
                aria-label={`${badges[t.id]} escalations need your action`}
                className={`ml-auto rounded-full px-1.5 py-px text-[10px] font-bold leading-4 animate-pulse ${activeView === t.id ? 'bg-white text-brembo-red' : 'bg-brembo-red text-white'}`}
              >
                {badges[t.id] > 99 ? '99+' : badges[t.id]}
              </span>
            )}
          </button>
        ))}

        {session.role === 'Admin' && (
          <>
            <div className="flex items-center gap-2.5 px-2.5 py-2 rounded text-[13px] font-semibold text-brembo-sub">
              <UsersRound size={15} className="opacity-75 shrink-0" />
              Team
            </div>
            <div className="ml-3.5 flex flex-col gap-px">
              {teamMembers.map((name) => (
                <button
                  key={name}
                  onClick={() => onSelectManager(name)}
                  className={`text-left px-2.5 py-1.5 rounded text-xs ${
                    viewAsManager === name ? 'text-brembo-red font-bold' : 'text-brembo-sub hover:bg-brembo-panel2 hover:text-brembo-ink'
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </>
        )}
      </nav>

      <div className="mt-auto border-t border-brembo-line pt-3 text-xs text-brembo-sub">
        <b className="block text-brembo-ink text-[13px]">{session.display || session.name}</b>
        <span className="inline-flex mt-1 bg-brembo-red/10 border border-brembo-red/20 text-brembo-red rounded-full px-2 py-0.5 text-[10px] font-bold">{session.role} · {session.role === 'Admin' ? 'Global' : session.role === 'Dept Head' ? 'Department head' : session.role === 'Manager' ? 'My tracker' : 'My actions'}</span>
        <button onClick={onLogout} className="mt-3 w-full border border-brembo-line hover:border-brembo-red hover:text-brembo-red rounded-lg px-2.5 py-2 text-[11.5px] text-brembo-sub flex items-center justify-center gap-2">
          <LogOut size={13} /> Log out
        </button>
      </div>
    </aside>
  );
}
