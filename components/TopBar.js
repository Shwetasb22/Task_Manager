'use client';
import { useState, useRef, useEffect, useMemo } from 'react';
import { Bell, BellRing, Menu, Search } from 'lucide-react';
import { dueSoonAlerts, getTaskStatusPresentation } from '@/lib/rules';
import { buildNotifications } from '@/lib/events';
import { ESCALATION_LABELS, escalationTarget, escalationsFor } from '@/lib/escalations';

export default function TopBar({ visibleTasks, events = [], session, onOpenTask, onMenuToggle }) {
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState(null);
  const [bellOpen, setBellOpen] = useState(false);
  const [readStorageWarning, setReadStorageWarning] = useState('');
  const bellRef = useRef(null);

  const alerts = useMemo(() => dueSoonAlerts(visibleTasks, 5), [visibleTasks]);
  const escalationAlerts = useMemo(() => escalationsFor(visibleTasks, session), [visibleTasks, session]);
  const notificationUserKey = session?.id || `${session?.role || 'guest'}-${session?.name || session?.display || 'guest'}`;
  const notificationReadKey = `brembo.notifications.read.v1.${notificationUserKey}`;
  const [readState, setReadState] = useState({ key: notificationReadKey, ids: new Set() });
  const updates = useMemo(() => buildNotifications(events, visibleTasks, session), [events, visibleTasks, session]);
  const readIds = readState.key === notificationReadKey ? readState.ids : new Set();
  const alertId = (task) => `due:${task.id}:${task.due || ''}`;
  const escalationId = (task) => `escalation:${task.id}:${task.esc}`;
  const updateId = (item) => `event:${item.id}`;
  const unreadAlerts = alerts.filter((task) => !readIds.has(alertId(task)));
  const unreadEscalations = escalationAlerts.filter((task) => !readIds.has(escalationId(task)));
  const unreadUpdates = updates.filter((item) => !readIds.has(updateId(item)));
  const notificationCount = unreadEscalations.length + unreadAlerts.length + unreadUpdates.length;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(notificationReadKey);
      const stored = saved ? JSON.parse(saved) : [];
      if (!Array.isArray(stored)) throw new Error('Invalid notification read state.');
      setReadState({
        key: notificationReadKey,
        ids: new Set(stored.filter((id) => typeof id === 'string')),
      });
      setReadStorageWarning('');
    } catch {
      setReadState({ key: notificationReadKey, ids: new Set() });
      setReadStorageWarning('Read status could not be loaded. Notifications may appear unread again.');
    }
  }, [notificationReadKey]);

  function toggleBell() {
    setBellOpen((open) => !open);
  }

  function markRead(id) {
    const next = new Set(readIds);
    next.add(id);
    setReadState({ key: notificationReadKey, ids: next });
    try {
      window.localStorage.setItem(notificationReadKey, JSON.stringify([...next]));
      setReadStorageWarning('');
    } catch {
      setReadStorageWarning('Read status could not be saved. Notifications may appear unread again.');
    }
  }

  function markAllRead() {
    const next = new Set(readIds);
    escalationAlerts.forEach((task) => next.add(escalationId(task)));
    alerts.forEach((task) => next.add(alertId(task)));
    updates.forEach((item) => next.add(updateId(item)));
    setReadState({ key: notificationReadKey, ids: next });
    try {
      window.localStorage.setItem(notificationReadKey, JSON.stringify([...next]));
      setReadStorageWarning('');
    } catch {
      setReadStorageWarning('Read status could not be saved. Notifications may appear unread again.');
    }
  }

  useEffect(() => {
    function onClick(e) {
      if (bellRef.current && !bellRef.current.contains(e.target)) setBellOpen(false);
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  function ask(e) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    const ql = q.toLowerCase();
    let scope = visibleTasks;
    // Match department names as whole words, so "open issues" is not read as department "PE".
    const words = new Set(ql.split(/[^a-z0-9&-]+/).filter(Boolean));
    const depts = [...new Set(visibleTasks.map((t) => t.dept).filter(Boolean))].filter((d) => words.has(d.toLowerCase()));
    if (depts.length) scope = scope.filter((t) => depts.includes(t.dept));
    const statusQueries = [
      { labels: ['red', 'overdue'], matches: (task) => task.status === 'Overdue' },
      { labels: ['yellow', 'due soon'], matches: (task) => task.rgy === 'Yellow' },
      { labels: ['green', 'on track', 'healthy'], matches: (task) => task.rgy === 'Green' },
      { labels: ['blue', 'closed', 'completed'], matches: (task) => task.status === 'Closed' },
      { labels: ['grey', 'gray', 'gap', 'no target', 'no date'], matches: (task) => task.rgy === 'Grey' },
    ];
    statusQueries.forEach(({ labels, matches }) => {
      if (labels.some((label) => ql.includes(label))) scope = scope.filter(matches);
    });
    if (!scope.length) {
      setAnswer(`No issues match "${q}" in your current view.`);
    } else {
      const closed = scope.filter((t) => t.status === 'Closed').length;
      setAnswer(
        `Found ${scope.length} issue(s) matching "${q}" — ${closed} closed, ${scope.length - closed} open. Top item: ${scope[0].id} (${scope[0].program}, ${scope[0].dept}), due ${scope[0].due || 'not set'}.`
      );
    }
    setQuery('');
  }

  return (
    <div className="print:hidden flex items-center gap-3.5 px-4 md:px-6 py-3 border-b border-brembo-line bg-white sticky top-0 z-20 shadow-[0_8px_24px_rgba(28,20,24,0.05)]">
      <button className="md:hidden text-brembo-sub hover:text-brembo-ink" onClick={onMenuToggle} aria-label="Open navigation">
        <Menu size={20} />
      </button>
      <div className="flex-1 max-w-xl mx-auto">
        <form onSubmit={ask} className="flex items-center bg-white border border-brembo-line hover:border-brembo-red/60 rounded-full pl-3.5 pr-1.5 py-1 shadow-card">
          <Search size={15} className="text-brembo-sub shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Ask about program status, e.g. 'red issues in LAUNCH'"
            className="flex-1 bg-transparent border-none text-sm px-2.5 py-1.5 focus:outline-none"
          />
          <button type="submit" className="bg-brembo-red hover:bg-[#ff3d56] text-white rounded-full px-4 py-1.5 text-xs font-bold">
            Search
          </button>
        </form>
        {answer && (
          <div className="mt-2 bg-white border border-brembo-line rounded-lg px-3.5 py-3 text-[13px] leading-relaxed shadow-card">
            {answer}
          </div>
        )}
      </div>
      <div className="relative shrink-0" ref={bellRef}>
        <button
          onClick={toggleBell}
          className="relative bg-white border border-brembo-line w-[38px] h-[38px] rounded-full flex items-center justify-center shadow-card"
          aria-label={`Notifications${notificationCount ? `, ${notificationCount} new` : ''}`}
          aria-expanded={bellOpen}
          aria-controls="notification-panel"
        >
          <Bell size={16} />
          {notificationCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-brembo-red text-white text-[10px] font-bold rounded-full px-[5px] leading-tight">
              {notificationCount > 99 ? '99+' : notificationCount}
            </span>
          )}
        </button>
        {bellOpen && (
          <div id="notification-panel" className="absolute right-0 top-[46px] w-[min(360px,calc(100vw-1.5rem))] bg-white border border-brembo-line rounded-lg p-2 z-20 max-h-[min(70vh,32rem)] overflow-auto shadow-defined">
            <div className="flex items-center justify-between gap-2 px-2 py-1.5">
              <span className="text-[11px] text-brembo-sub uppercase tracking-wide">Notifications</span>
              {notificationCount > 0 && (
                <button type="button" onClick={markAllRead} className="text-[10.5px] font-semibold text-brembo-red hover:underline">
                  Mark all read
                </button>
              )}
            </div>
            {readStorageWarning && <div className="px-2 py-1.5 text-[11px] text-[#9b1224]" role="status">{readStorageWarning}</div>}
            <div className="px-2 py-1.5 text-[11px] text-brembo-sub uppercase tracking-wide border-t border-brembo-line">Escalations assigned to your role</div>
            {escalationAlerts.length ? escalationAlerts.map((task) => {
              const id = escalationId(task);
              const unread = !readIds.has(id);
              return (
                <button type="button" key={id} onClick={() => { markRead(id); setBellOpen(false); if (onOpenTask) onOpenTask(task.id); }}
                  className={`block w-full rounded border-b border-brembo-line p-2 text-left text-xs hover:bg-brembo-red/5 ${unread ? 'bg-brembo-red/[0.06]' : ''}`}>
                  <span className="flex items-start gap-2">
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${unread ? 'bg-brembo-red' : 'bg-transparent'}`} aria-hidden="true" />
                    <span className="min-w-0"><b className="block text-[#9b1224]"><BellRing size={11} className="mr-1 inline" />{ESCALATION_LABELS[task.esc] || task.esc} · {task.id} · {task.program}</b>
                      <small className="text-brembo-sub">{task.desc} · Owner: {task.owner || 'Unassigned'} · Target: {task.due || 'not set'} · Escalated to {escalationTarget(task)}</small></span>
                  </span>
                </button>
              );
            }) : <div className="p-2 text-xs text-brembo-sub">No L1/L2/L3 escalations are assigned to you.</div>}
            <div className="px-2 py-1.5 text-[11px] text-brembo-sub uppercase tracking-wide border-t border-brembo-line">Due in next 5 days</div>
            {alerts.length ? (
              alerts.map((task) => {
                const id = alertId(task);
                const unread = !readIds.has(id);
                return (
                  <button
                    type="button"
                    key={id}
                    onClick={() => { markRead(id); setBellOpen(false); if (onOpenTask) onOpenTask(task.id); }}
                    className={`block w-full text-left p-2 rounded text-xs border-b border-brembo-line last:border-0 hover:bg-brembo-red/5 ${unread ? 'bg-brembo-red/[0.04]' : ''}`}
                  >
                    <span className="flex items-start gap-2">
                      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${unread ? 'bg-brembo-red' : 'bg-transparent'}`} aria-hidden="true" />
                      <span className="min-w-0">
                        <b className="block">{task.id} · {task.program}</b>
                        <small className="text-brembo-sub">{task.dept} — {task.alert || getTaskStatusPresentation(task).label}</small>
                      </span>
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="p-2 text-xs text-brembo-sub">No items due in the next 5 days.</div>
            )}
            <div className="px-2 py-1.5 mt-2 text-[11px] text-brembo-sub uppercase tracking-wide border-t border-brembo-line">
              {session?.role === 'Owner' ? 'Updates and comments on your issues' : 'Mentions, comments, closed issues to review and proof uploads'}
            </div>
            {updates.length ? updates.map((item) => {
              const id = updateId(item);
              const unread = !readIds.has(id);
              return (
                <button
                  type="button"
                  key={id}
                  onClick={() => { markRead(id); setBellOpen(false); if (onOpenTask) onOpenTask(item.taskId); }}
                  className={`block w-full text-left p-2 rounded text-xs border-b border-brembo-line last:border-0 hover:bg-brembo-red/5 ${unread ? 'bg-brembo-red/[0.04]' : ''}`}
                >
                  <span className="flex items-start gap-2">
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${unread ? 'bg-brembo-red' : 'bg-transparent'}`} aria-hidden="true" />
                    <span className="min-w-0">
                      <b className="block">{item.taskId} · {item.program}</b>
                      <small className="text-brembo-sub">{item.text} · {new Date(item.at).toLocaleString()}</small>
                    </span>
                  </span>
                </button>
              );
            }) : (
              <div className="p-2 text-xs text-brembo-sub">No updates yet.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
