'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import AuthScreen, { SetPassword } from '@/components/AuthScreen';
import Logo from '@/components/Logo';
import Sidebar from '@/components/Sidebar';
import TopBar from '@/components/TopBar';

// Screens are split into their own chunks and fetched when first opened, so the landing and
// sign-in screens load fast and heavy libraries (charts, Excel parsing) arrive only when needed.
const ViewLoading = () => <div className="text-brembo-sub text-[13px]">Loading…</div>;
const Dashboard = dynamic(() => import('@/components/Dashboard'), { loading: ViewLoading });
const MorningUpdate = dynamic(() => import('@/components/MorningUpdate'), { loading: ViewLoading });
const WeeklyReport = dynamic(() => import('@/components/WeeklyReport'), { loading: ViewLoading });
const Lists = dynamic(() => import('@/components/Lists'), { loading: ViewLoading });
const TaskRegister = dynamic(() => import('@/components/TaskRegister'), { loading: ViewLoading });
const UploadedProofs = dynamic(() => import('@/components/UploadedProofs'), { loading: ViewLoading });
const ProofViewer = dynamic(() => import('@/components/ProofViewer'));
const Sop = dynamic(() => import('@/components/Sop'), { loading: ViewLoading });
const AddIssueModal = dynamic(() => import('@/components/AddIssueModal'));
const IssueHistory = dynamic(() => import('@/components/IssueHistory'));
const ImportExcelModal = dynamic(() => import('@/components/ImportExcelModal'));
const People = dynamic(() => import('@/components/People'), { loading: ViewLoading });
import { issueFromRow, patchFromChanges } from '@/lib/excel-import';
import { normalizeDepartment } from '@/lib/departments';
import { issuePrefix, sortBySerial } from '@/lib/issues';
import { fmtDate, MAIN_TEAM_MANAGERS } from '@/lib/data';
import { deriveTask, startOfToday } from '@/lib/rules';
import { revisedDateError } from '@/lib/due-policy';
import { rollbackTaskPatch } from '@/lib/task-patches';
import { validateFile } from '@/lib/proofs';
import { getRuntimeConfig, store } from '@/lib/store';
import { isOwnerOf } from '@/lib/owners';
import { buildRemark } from '@/lib/remarks';
import { escalationsFor } from '@/lib/escalations';
import { applyLiveChange } from '@/lib/live';
import { formatError } from '@/lib/errors';

const NO_FILTERS = { dept: 'All', owner: 'All', customer: 'All', program: 'All', rgy: 'All', due: 'All' };

const VALID_ROLES = new Set(['Admin', 'Dept Head', 'Manager', 'Owner']);

function isValidSession(candidate) {
  const hasLocalDemoIdentity = store.mode === 'local' && candidate?.name;
  return Boolean(candidate && (candidate.id || hasLocalDemoIdentity) && candidate.role && VALID_ROLES.has(candidate.role));
}

function LandingScreen({ onContinue }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 md:p-8 bg-brembo-paper"
      style={{ backgroundImage: 'radial-gradient(650px 520px at 12% 15%, rgba(200, 16, 46, 0.08), transparent 58%), radial-gradient(700px 530px at 90% 90%, rgba(217, 163, 26, 0.1), transparent 62%), linear-gradient(135deg, #f7f5f3 0%, #f4f2f0 40%, #f6eef1 100%)' }}>
      <div className="w-full max-w-6xl glass-panel rounded-[28px] overflow-hidden p-6 md:p-10">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-8">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3 mb-6">
              <Logo size={40} priority />
              <div>
                <div className="text-brembo-red text-[11px] uppercase tracking-[.22em] font-bold">Brembo India</div>
                <div className="text-brembo-sub text-[11px] uppercase tracking-[.18em]">Digital operations platform</div>
              </div>
            </div>

            <h1 className="font-display text-4xl md:text-6xl xl:text-7xl font-bold leading-[0.95] tracking-[-0.04em]">
              Brembo India<br />Digital Command Center
            </h1>

            <p className="mt-6 max-w-xl text-brembo-sub text-sm md:text-base leading-7">
              Future-ready manufacturing operations for Chakan and branch teams.
            </p>
            <p className="mt-2 max-w-xl text-brembo-ink text-sm md:text-base leading-7">
              Connected visibility for digital transformation and execution excellence.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <button onClick={onContinue} className="bg-brembo-red hover:bg-[#ff3d56] text-white font-bold text-sm px-6 py-3.5 rounded-xl shadow-[0_12px_28px_rgba(229,45,69,.28)]">
                Enter system access
              </button>
            </div>
          </div>

          <div className="w-full max-w-xl rounded-[24px] border border-brembo-line bg-brembo-panel2 p-5 md:p-6">
            <div className="flex items-center justify-between pb-4 border-b border-brembo-line">
              <div>
                <div className="text-[11px] uppercase tracking-[.18em] text-brembo-sub">Strategic roadmap</div>
                <div className="mt-2 text-xl font-bold text-brembo-ink">Industry 4.0 Operating Model</div>
              </div>
              <div className="w-11 h-11 rounded-full border border-brembo-red/40 bg-brembo-red/10 flex items-center justify-center text-brembo-red font-bold">4.0</div>
            </div>

            <div className="mt-5 space-y-4 text-sm text-brembo-sub">
              <div className="flex items-start justify-between gap-4 border-b border-brembo-line pb-3">
                <span>Digital traceability</span>
                <span className="text-brembo-ink font-semibold">Live</span>
              </div>
              <div className="flex items-start justify-between gap-4 border-b border-brembo-line pb-3">
                <span>Cross-branch coordination</span>
                <span className="text-brembo-ink font-semibold">Connected</span>
              </div>
              <div className="flex items-start justify-between gap-4 border-b border-brembo-line pb-3">
                <span>Leadership decision support</span>
                <span className="text-brembo-ink font-semibold">Actionable</span>
              </div>
              <div className="flex items-start justify-between gap-4">
                <span>Execution governance</span>
                <span className="text-brembo-ink font-semibold">Structured</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [entryStep, setEntryStep] = useState('landing');
  const [sessionError, setSessionError] = useState(null);
  const [viewAsManager, setViewAsManager] = useState(null);
  const [activeView, setActiveView] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [raw, setRaw] = useState([]); // raw tracker rows (+proofs); everything else is derived
  const [loading, setLoading] = useState(false);
  const [redFlagCount, setRedFlagCount] = useState(0);
  const [managerNames, setManagerNames] = useState([]);
  const [deptList, setDeptList] = useState([]); // managed department list (database update 0021); empty = use the data
  const [events, setEvents] = useState([]); // audit trail rows for the notification bell
  const [employees, setEmployees] = useState([]); // people who can own an issue (owner dropdown)
  const [savedViews, setSavedViews] = useState([]); // this person's saved Task Register views
  const [filters, setFilters] = useState(NO_FILTERS);
  const [notice, setNotice] = useState(null); // { type: 'ok' | 'error', text }
  const [viewer, setViewer] = useState(null); // { task, proof }
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [taskNavigation, setTaskNavigation] = useState(null);
  const [historyTask, setHistoryTask] = useState(null);
  const [today, setToday] = useState(() => startOfToday());

  const runtimeConfig = getRuntimeConfig();
  const supabaseConfigIncomplete = runtimeConfig.partial;
  const sessionActive = Boolean(session);

  const flash = useCallback((type, text) => {
    setNotice({ type, text });
    if (type === 'ok') setTimeout(() => setNotice((n) => (n && n.text === text ? null : n)), 4000);
  }, []);

  // Restore an existing sign-in (production) and react to password-recovery links.
  useEffect(() => {
    if (store.mode === 'local') {
      setAuthReady(true);
      setSessionError(null);
      return () => {};
    }

    store.getSession()
      .then((s) => {
        if (isValidSession(s)) {
          setSession(s);
          setSessionError(null);
          setEntryStep('app');
          return;
        }
        setSession(null);
        setSessionError(null);
        setEntryStep('landing');
      })
      .catch(() => {
        setSession(null);
        setSessionError('The session could not be restored. Please sign in again.');
        setEntryStep('landing');
      })
      .finally(() => setAuthReady(true));

    return store.onAuthEvent((ev) => {
      if (ev === 'PASSWORD_RECOVERY') setRecovery(true);
      if (ev === 'SIGNED_OUT') {
        setSession(null);
        setSessionError(null);
        setEntryStep('landing');
      }
    });
  }, []);

  // RGY/status are date-driven: roll over automatically if the tab stays open past midnight.
  useEffect(() => {
    const id = setInterval(() => {
      const n = startOfToday();
      setToday((cur) => (n.getTime() !== cur.getTime() ? n : cur));
    }, 60000);
    return () => clearInterval(id);
  }, []);

  const refreshEvents = useCallback(() => {
    store.listEvents().then(setEvents).catch(() => {});
  }, []);

  // Archived issues (closed over a year ago) are added to the register only while "Show archived" is on.
  const [showArchived, setShowArchived] = useState(false);
  const showArchivedRef = useRef(false);
  const reload = useCallback(async () => {
    try {
      const current = await store.loadTasks();
      if (showArchivedRef.current && store.loadArchivedTasks) {
        const ids = new Set(current.map((t) => t.id));
        const archived = (await store.loadArchivedTasks()).filter((t) => !ids.has(t.id));
        setRaw([...current, ...archived]);
      } else {
        setRaw(current);
      }
      if (store.getRedFlagCount) {
        try {
          const count = await store.getRedFlagCount();
          if (count !== null && count !== undefined) setRedFlagCount(count);
        } catch {}
      }
      refreshEvents();
      return true;
    } catch (e) {
      flash('error', `Could not load issues: ${formatError(e)}`);
      return false;
    }
  }, [flash, refreshEvents]);

  useEffect(() => {
    if (!session) return;
    setLoading(true);
    reload().finally(() => setLoading(false));
    store.listManagers().then(setManagerNames).catch((error) => flash('error', `Could not load trackers: ${formatError(error)}`));
    store.listDepartments().then(setDeptList).catch((error) => flash('error', `Could not load departments: ${formatError(error)}`));
    store.listEmployees().then(setEmployees).catch((error) => flash('error', `Could not load people: ${formatError(error)}`));
    store.listViews(session).then(setSavedViews).catch((error) => flash('error', `Could not load saved views: ${formatError(error)}`));
  }, [session, reload, flash]);

  // Process three-day owner response deadlines on sign-in, tab focus, and periodically while open.
  useEffect(() => {
    if (!sessionActive) return undefined;
    let alive = true;
    let lastRun = 0;
    const checkDueDates = async () => {
      lastRun = Date.now();
      try {
        // Reload only when the job actually changed issues; otherwise live updates keep the list current.
        const changed = await store.autoAcceptDueDates();
        if (alive && changed !== 0) await reload();
      } catch (error) {
        if (alive) flash('error', `Could not process target-date responses: ${formatError(error)}`);
      }
    };
    // Switching back to the tab triggers a check at most once a minute.
    const onFocus = () => { if (Date.now() - lastRun > 60000) checkDueDates(); };
    checkDueDates();
    const timer = setInterval(checkDueDates, 5 * 60 * 1000);
    window.addEventListener('focus', onFocus);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [sessionActive, reload, flash]);

  // Live updates from teammates (no-op in demo mode). Each change is applied to the one issue it
  // touches. A quiet full refresh follows a burst of changes (at most once a minute) to pick up
  // anything live updates cannot carry, such as an issue that was reassigned away from you.
  useEffect(() => {
    if (!session) return;
    let quiet; let firstPending = 0; let events;
    const off = store.subscribe((change) => {
      if (change?.type === 'profile') {
        if (session.role === 'Owner') {
          store.getSession().then((updated) => {
            if (isValidSession(updated)) setSession(updated);
            reload();
          });
        }
        return;
      }
      if (change?.type === 'employees') {
        store.listEmployees().then(setEmployees).catch((error) => flash('error', `Could not refresh people: ${formatError(error)}`));
        return;
      }
      if (change?.type === 'departments') {
        store.listDepartments().then(setDeptList).catch((error) => flash('error', `Could not refresh departments: ${formatError(error)}`));
        return;
      }
      if (change?.type === 'comment') {
        clearTimeout(events);
        events = setTimeout(refreshEvents, 300);
        return;
      }
      setRaw((current) => applyLiveChange(current, change));
      clearTimeout(events);
      events = setTimeout(refreshEvents, 1000);
      const now = Date.now();
      if (!firstPending) firstPending = now;
      clearTimeout(quiet);
      quiet = setTimeout(() => { firstPending = 0; reload(); }, Math.max(0, Math.min(20000, firstPending + 60000 - now)));
    }, session.id);
    return () => {
      clearTimeout(quiet);
      clearTimeout(events);
      off();
    };
  }, [session, reload, refreshEvents, flash]);

  const tasks = useMemo(() => sortBySerial(raw.map((t) => deriveTask(t, today))), [raw, today]);
  // Id lookup for bulk actions (selecting all issues would otherwise scan the list once per issue).
  const rawById = useMemo(() => new Map(raw.map((t) => [t.id, t])), [raw]);
  const archivedCount = useMemo(() => raw.reduce((n, t) => n + (t.archived ? 1 : 0), 0), [raw]);
  const openTaskInRegister = useCallback((id) => {
    const task = tasks.find((item) => item.id === id);
    if (!task) return;
    const closedOnly = task.status === 'Closed';
    setTaskNavigation({ id, closedOnly });
    setActiveView(closedOnly ? 'closed' : 'register');
  }, [tasks]);
  const clearTaskNavigation = useCallback(() => setTaskNavigation(null), []);
  const managers = useMemo(() => [...new Set([...managerNames, ...raw.map((t) => t.manager)])].filter(Boolean).sort(), [managerNames, raw]);
  const teamMembers = MAIN_TEAM_MANAGERS;
  // Trackers and departments offered in pickers: the managed lists when the database has them.
  const trackerChoices = store.mode === 'supabase' && managerNames.length ? managerNames : managers;
  const viewAsTracker = managers.includes(viewAsManager) ? viewAsManager : null;
  const departmentChoices = useMemo(() => (deptList.length ? deptList.filter((d) => d.active).map((d) => d.code) : null), [deptList]);
  const listsChanged = useCallback(() => {
    reload();
    store.listManagers().then(setManagerNames).catch(() => {});
    store.listDepartments().then(setDeptList).catch(() => {});
  }, [reload]);

  function handleLogin(user) {
    if (!isValidSession(user)) {
      setSessionError('Invalid user session. Please sign in again.');
      setSession(null);
      setEntryStep('landing');
      return;
    }
    setSession(user);
    setSessionError(null);
    setEntryStep('app');
    setViewAsManager(null);
    setActiveView('dashboard');
    setFilters(NO_FILTERS);
  }
  async function handleLogout() {
    try { await store.signOut(); } catch {}
    setSession(null);
    setRaw([]);
    setRedFlagCount(0);
    setViewAsManager(null);
    setEntryStep('landing');
  }

  // UI scoping mirrors the database rules; the database is what actually enforces them.
  const scopedTasks = useMemo(() => {
    if (!session) return [];
    if (session.role === 'Admin') {
      if (!viewAsManager) return tasks;
      return managers.includes(viewAsManager)
        ? tasks.filter((t) => t.manager === viewAsManager)
        : tasks.filter((t) => isOwnerOf({ role: 'Owner', name: viewAsManager, aliases: [] }, t));
    }
    if (session.role === 'Manager') return tasks.filter((t) => t.manager === session.name);
    if (session.role === 'Owner') return tasks.filter((t) => isOwnerOf(session, t));
    return tasks;
  }, [tasks, session, viewAsManager, managers]);

  // L1/L2/L3 escalations addressed to this person (badge on the Morning Update tab).
  const myEscalationCount = useMemo(() => escalationsFor(scopedTasks, session).length, [scopedTasks, session]);

  // Optimistic update, then persist; roll back and tell the user if the server refuses.
  async function patch(id, p) {
    const task = raw.find((item) => item.id === id);
    const previousFields = Object.fromEntries(Object.keys(p).map((key) => [key, task?.[key]]));
    setRaw((r) => r.map((t) => (t.id === id ? { ...t, ...p } : t)));
    try {
      await store.patchTask(id, p, session);
      refreshEvents();
      return true;
    } catch (e) {
      setRaw((current) => rollbackTaskPatch(current, id, previousFields));
      flash('error', formatError(e));
      return false;
    }
  }
  const setRemark = (id, val) => patch(id, { remark: val });
  const setDue = async (id, val) => {
    const saved = await patch(id, { due: val || null });
    if (saved) await reload();
  };
  const setNextDate = (id, val) => {
    const task = raw.find((item) => item.id === id);
    const error = revisedDateError(task?.due, val);
    if (error) { flash('error', error); return false; }
    return patch(id, { next: val || null });
  };
  const setDueAcceptance = async (id, value) => {
    const saved = await patch(id, { dueAcceptance: value });
    if (saved) await reload();
  };
  const setOwner = (id, val) => patch(id, { owner: val.trim() || 'Unassigned' });
  async function toggleRedFlag(id) {
    const task = raw.find((item) => item.id === id);
    if (!task || task.closed || String(task.sourceStatus || '').toLowerCase() === 'closed') return false;
    const saved = await patch(id, { redFlag: !task.redFlag });
    if (saved && store.getRedFlagCount) {
      try {
        const count = await store.getRedFlagCount();
        if (count !== null && count !== undefined) setRedFlagCount(count);
      } catch {}
    }
    return saved;
  }
  function openEditTask(id) {
    const task = raw.find((item) => item.id === id);
    if (!task) return;
    const isClosed = task.closed || String(task.sourceStatus || '').toLowerCase() === 'closed';
    const canReviewClosed = ['Manager', 'Dept Head', 'Admin'].includes(session.role);
    const canOwnerEditClosed = session.role === 'Owner' && isOwnerOf(session, task);
    if (isClosed && !canReviewClosed && !canOwnerEditClosed) {
      flash('error', 'Only the assigned owner can edit a closed issue; a manager can review or reopen it.');
      return;
    }
    setEditTask(task);
  }
  async function closeIssue(id, proofUploaded = false) {
    const task = raw.find((item) => item.id === id);
    const canClose = ['Manager', 'Admin'].includes(session.role) || (session.role === 'Owner' && isOwnerOf(session, task));
    if (!canClose) {
      flash('error', 'Only the assigned owner or a manager can close this issue.');
      return false;
    }
    if (!task || (!(task.proofs || []).length && !proofUploaded)) {
      flash('error', 'Attach proof before closing this issue.');
      return false;
    }
    const message = session.role === 'Owner'
      ? 'Close this issue? Your manager will check the proof and can reopen it and send it back to you if it is not satisfactory.'
      : 'Confirm that you reviewed the attached proof and want to close this issue?';
    if (window.confirm(message)) {
      return patch(id, { closed: fmtDate(today) });
    }
    return false;
  }
  async function reopen(id) {
    if (!['Manager', 'Admin'].includes(session.role)) {
      flash('error', 'Only a manager can reopen a closed issue.');
      return false;
    }
    const task = raw.find((t) => t.id === id);
    if (window.confirm(`Reopen ${id} and send it back to ${task?.owner || 'the owner'}? It will return to Open/Overdue based on its target date.`)) {
      return patch(id, { closed: null, sourceStatus: 'Open' });
    }
    return false;
  }

  async function addProof(id, files) {
    let allUploaded = true;
    for (const f of files) {
      const err = validateFile(f);
      if (err) { flash('error', `${f.name}: ${err}`); allUploaded = false; continue; }
      try {
        const proof = await store.addProof(id, f, session);
        refreshEvents();
        // The live update for this upload can arrive first; never list the same proof twice.
        setRaw((r) => applyLiveChange(r, { type: 'proof-added', taskId: id, proof }));
        flash('ok', session.role === 'Owner'
          ? `Proof uploaded for ${id}. Your manager can review it.`
          : `Proof attached to ${id}.`);
      } catch (e) {
        flash('error', `${f.name}: ${formatError(e)}`);
        allUploaded = false;
      }
    }
    return allUploaded;
  }
  async function removeProof(id, proof) {
    if (!window.confirm(`Remove "${proof.name}"? This is recorded in the audit trail.`)) return;
    try {
      await store.removeProof(id, proof, session);
      refreshEvents();
      setRaw((r) => r.map((t) => (t.id === id ? { ...t, proofs: (t.proofs || []).filter((p) => p.id !== proof.id) } : t)));
      const task = raw.find((t) => t.id === id);
      flash('ok', task?.closed
        ? 'Proof removed. The issue stays closed — use Reopen if it should be open again.'
        : `Proof "${proof.name}" removed from ${id}.`);
    } catch (e) {
      flash('error', formatError(e));
    }
  }
  const viewProof = (task, proof) => setViewer({ task, proof });

  // Only the Platform Manager application role may create new issues. Keep edit permissions
  // separate so limiting creation does not remove existing review/edit work.
  const canAddIssue = session?.role === 'Manager' && !session.pending;
  const canEditIssue = ['Admin', 'Dept Head', 'Owner'].includes(session?.role) || (session?.role === 'Manager' && !session.pending);
  const canDeleteIssue = session?.role === 'Admin' || (session?.role === 'Manager' && !session.pending);

  // Throws on failure so the form can show the reason and stay open.
  async function addIssue(issue, proofFiles = []) {
    const task = await store.addTask(issue, session);
    refreshEvents();
    // Show it immediately for the person who added it; Realtime refreshes everyone else.
    setRaw((r) => (r.some((t) => t.id === task.id) ? r : [task, ...r]));
    setFilters(NO_FILTERS);
    setAddOpen(false);
    flash('ok', `Issue ${task.id} added to ${task.manager}'s tracker.`);
    if (proofFiles.length) await addProof(task.id, proofFiles);
  }

  // Saves an Excel import plan. New issues are added one after another (so their IDs follow the
  // sheet order); updates run 6 at a time, which makes large imports several times faster. Rows
  // that fail are reported and the rest still save.
  async function importExcel(manager, items, onProgress, replaceExisting = false) {
    if (replaceExisting) {
      const before = raw;
      setRaw([]);
      try {
        const allIds = store.listAllTaskIds ? await store.listAllTaskIds() : before.map((task) => task.id);
        await store.deleteTasks(allIds, session);
      } catch (error) {
        await reload();
        throw error;
      }
    }
    const finish = async (added, updated, failed) => {
      await reload();
      refreshEvents();
      setFilters(NO_FILTERS);
      if (added || updated) flash('ok', `Excel import: ${added} added and ${updated} updated in ${manager}'s tracker.`);
      return { added, updated, failed };
    };
    const addItems = items.filter((i) => i.kind === 'add');
    const updates = items.filter((i) => i.kind !== 'add');
    let added = 0;
    let updated = 0;
    let done = 0;
    const failed = [];
    const processedAdds = new Set();
    const processedUpdates = new Set();

    // Keep each database import request bounded; the SQL function applies each batch atomically.
    if (store.importTasks) {
      const addBatches = Array.from({ length: Math.ceil(addItems.length / 500) }, (_, i) => addItems.slice(i * 500, (i + 1) * 500));
      const updateBatches = Array.from({ length: Math.ceil(updates.length / 500) }, (_, i) => updates.slice(i * 500, (i + 1) * 500));
      for (const batch of addBatches) {
        const adds = batch.map((item) => {
          const issue = issueFromRow(item.row, manager, issuePrefix(raw, manager));
          return {
            row: item.row.rowNumber, ...issue,
            source_status: issue.sourceStatus,
            dept: normalizeDepartment(issue.dept),
          };
        });
        try {
          const saved = await store.importTasks(manager, adds, []);
          if (!saved) break;
          added += saved.added;
          batch.forEach((item) => processedAdds.add(item));
        } catch (error) {
          for (const item of batch) {
            try {
              const issue = issueFromRow(item.row, manager, issuePrefix(raw, manager));
              const saved = await store.importTasks(manager, [{
                row: item.row.rowNumber, ...issue, source_status: issue.sourceStatus,
                dept: normalizeDepartment(issue.dept),
              }], []);
              if (!saved) break;
              added += saved.added;
              processedAdds.add(item);
            } catch (rowError) {
              failed.push({ item, error: formatError(rowError) });
              processedAdds.add(item);
            }
          }
        }
        done += batch.length;
        onProgress(done);
      }
      const changedOwners = new Set();
      for (const batch of updateBatches) {
        const patchRows = batch.map((item) => {
          const patch = patchFromChanges(item.changes);
          if (Object.prototype.hasOwnProperty.call(patch, 'sourceStatus')) {
            patch.source_status = patch.sourceStatus;
            delete patch.sourceStatus;
          }
          const seen = item.task.updatedAt && !changedOwners.has(item.task.id) ? { seen: item.task.updatedAt } : {};
          changedOwners.add(item.task.id);
          return { row: item.row.rowNumber, id: item.task.id, patch, ...seen };
        });
        try {
          const saved = await store.importTasks(manager, [], patchRows);
          if (!saved) break;
          updated += saved.updated;
          batch.forEach((item) => processedUpdates.add(item));
        } catch (error) {
          for (const item of batch) {
            const patch = patchFromChanges(item.changes);
            if (Object.prototype.hasOwnProperty.call(patch, 'sourceStatus')) {
              patch.source_status = patch.sourceStatus;
              delete patch.sourceStatus;
            }
            const update = { row: item.row.rowNumber, id: item.task.id, patch };
            if (item.task.updatedAt && !changedOwners.has(item.task.id)) update.seen = item.task.updatedAt;
            changedOwners.add(item.task.id);
            try {
              const saved = await store.importTasks(manager, [], [update]);
              if (!saved) break;
              updated += saved.updated;
              processedUpdates.add(item);
            } catch (rowError) {
              failed.push({ item, error: formatError(rowError || error) });
              processedUpdates.add(item);
            }
          }
        }
        done += batch.length;
        onProgress(done);
      }
      if (processedAdds.size === addItems.length && processedUpdates.size === updates.length) return finish(added, updated, failed);
    }

    // Older database or demo mode: save row by row and report the rows that failed.
    const step = () => { done += 1; onProgress(done); };
    for (const item of addItems.filter((row) => !processedAdds.has(row))) {
      try {
        await store.addTask(issueFromRow(item.row, manager, issuePrefix(raw, manager)), session);
        added += 1;
      } catch (error) {
        failed.push({ item, error: formatError(error) });
      }
      step();
    }
    const remainingUpdates = updates.filter((item) => !processedUpdates.has(item));
    let next = 0;
    const worker = async () => {
      while (next < remainingUpdates.length) {
        const item = remainingUpdates[next];
        next += 1;
        try {
          await store.patchTask(item.task.id, patchFromChanges(item.changes), session);
          updated += 1;
        } catch (error) {
          failed.push({ item, error: formatError(error) });
        }
        step();
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, remainingUpdates.length) }, worker));
    return finish(added, updated, failed);
  }

  // Saves only the fields that changed; each change is recorded in the issue history.
  async function saveIssueEdits(issue, proofFiles = [], lifecycle = {}) {
    const task = raw.find((item) => item.id === editTask?.id);
    if (!task) throw new Error('This issue is no longer in the register. Refresh and try again.');
    const isClosed = task.closed || String(task.sourceStatus || '').toLowerCase() === 'closed';
    const canOwnerEditClosed = session.role === 'Owner' && isOwnerOf(session, task);
    const canManagerReviewClosed = ['Manager', 'Dept Head', 'Admin'].includes(session.role);
    if (isClosed && !canOwnerEditClosed && !canManagerReviewClosed) throw new Error('You do not have access to edit this closed issue.');
    if (isClosed && canManagerReviewClosed && proofFiles.length) throw new Error('Managers can review closed proof but cannot replace the owner’s evidence.');
    const isManagerSide = ['Manager', 'Admin'].includes(session.role);
    if (lifecycle.closeAfterSave && !isManagerSide && !canOwnerEditClosed) throw new Error('Only the assigned owner or a manager can close this issue.');
    if (lifecycle.reopenAfterSave && !isManagerSide) throw new Error('Only a manager can reopen an issue.');
    if (lifecycle.reopenAfterSave && !String(lifecycle.ownerRemark || '').trim()) throw new Error('Write a remark telling the owner why the proof was not accepted.');
    const allFields = ['manager', 'customer', 'program', 'desc', 'dept', 'owner', 'initialManager', 'member', 'start', 'due', 'next', 'remark'];
    const fields = isClosed && !canOwnerEditClosed ? ['remark'] : allFields;
    const changes = {};
    fields.forEach((key) => {
      const next = issue[key] ?? null;
      if ((task[key] ?? null) !== next && !(task[key] == null && next === '')) changes[key] = next;
    });
    if (Object.keys(changes).length && !(await patch(task.id, changes))) throw new Error('The changes were not saved. See the message above the register.');
    const proofsUploaded = proofFiles.length ? await addProof(task.id, proofFiles) : true;
    if (!proofsUploaded) {
      flash('error', `Issue ${task.id} was updated, but one or more proof files failed to upload. Do not close it until the proof upload succeeds.`);
      return false;
    }
    if (lifecycle.closeAfterSave && !(await closeIssue(task.id, proofFiles.length > 0))) return false;
    if (lifecycle.reopenAfterSave) {
      if (!(await reopen(task.id))) return false;
      // The reopen succeeded; the remark tells the owner why. If only the remark fails, say so.
      if (!(await sendRemark(task, lifecycle.ownerRemark, { reopened: true, quiet: true }))) {
        setEditTask(null);
        return true;
      }
      setEditTask(null);
      flash('ok', `Issue ${task.id} reopened and your remark was sent to ${task.owner}.`);
      return true;
    }
    setEditTask(null);
    if (Object.keys(changes).length || proofFiles.length) flash('ok', `Issue ${task.id} updated.`);
    return true;
  }

  // A remark between manager and owner, saved as an @mention comment so it reaches the other side's bell.
  async function sendRemark(task, text, { reopened = false, quiet = false } = {}) {
    let remark;
    try {
      remark = buildRemark(task, session, text, { reopened });
    } catch (e) {
      if (quiet) { flash('error', formatError(e)); return false; }
      throw e;
    }
    try {
      await store.addComment(task.id, remark.text, remark.mentions, session);
    } catch (e) {
      const message = `${reopened ? `Issue ${task.id} was reopened, but the remark could not be sent` : 'The remark could not be sent'}: ${formatError(e)}`;
      if (quiet) { flash('error', message); return false; }
      throw new Error(message);
    }
    refreshEvents();
    if (!quiet) flash('ok', `Remark sent to the ${remark.side} of ${task.id}.`);
    return true;
  }

  // Employee list (People page). Each returns true when saved so the form can clear itself.
  const canManagePeople = ['Admin', 'Dept Head'].includes(session?.role) || (session?.role === 'Manager' && !session.pending);
  async function saveEmployee(emp) {
    try {
      await store.saveEmployee(emp, session);
      setEmployees(await store.listEmployees());
      flash('ok', emp.id ? `${emp.name} updated.` : `${emp.name} added to the list.`);
      return true;
    } catch (e) {
      flash('error', formatError(e));
      return false;
    }
  }
  async function deleteEmployee(emp) {
    try {
      await store.deleteEmployee(emp.id, session);
      setEmployees(await store.listEmployees());
      flash('ok', `${emp.name} removed from the list.`);
    } catch (e) {
      flash('error', formatError(e));
    }
  }
  async function saveDepartment(dept) {
    try {
      await store.saveDepartment(dept, session);
      setDeptList(await store.listDepartments());
      flash('ok', `${dept.code.trim()} department added.`);
      return true;
    } catch (e) {
      flash('error', formatError(e));
      return false;
    }
  }
  async function renameOwner(from, to) {
    try {
      const n = await store.renameOwner(from, to, session);
      await reload();
      flash('ok', `"${from}" was replaced with "${to}" in ${n} issue(s).`);
    } catch (e) {
      flash('error', formatError(e));
    }
  }

  async function toggleArchived() {
    showArchivedRef.current = !showArchivedRef.current;
    setShowArchived(showArchivedRef.current);
    await reload();
  }

  async function addComment(task, text, mentions) {
    try {
      await store.addComment(task.id, text, mentions, session);
      refreshEvents();
      return true;
    } catch (e) {
      flash('error', formatError(e));
      return false;
    }
  }
  async function editComment(commentId, text, mentions) {
    try {
      await store.updateComment(commentId, text, mentions, session);
      refreshEvents();
      return true;
    } catch (e) {
      flash('error', formatError(e));
      return false;
    }
  }

  async function saveView(name, filters) {
    try {
      const view = await store.saveView(name, filters, session);
      setSavedViews((list) => [...list, view].sort((a, b) => a.name.localeCompare(b.name)));
      flash('ok', `View "${view.name}" saved.`);
      return view;
    } catch (e) {
      flash('error', formatError(e));
      return null;
    }
  }
  async function deleteView(view) {
    try {
      await store.deleteView(view.id, session);
      setSavedViews((list) => list.filter((v) => v.id !== view.id));
    } catch (e) {
      flash('error', formatError(e));
    }
  }

  // Bulk changes from the Task Register. Each issue is saved on its own (6 at a time) so its history
  // is recorded and one refusal does not stop the rest; the screen updates first and rolls back the
  // issues the server refused.
  async function bulkUpdate(ids, makePatch, label) {
    const items = ids.map((id) => rawById.get(id)).filter(Boolean)
      .map((task) => ({ task, patch: makePatch(task) })).filter((item) => item.patch);
    if (!items.length) { flash('error', `${label}: none of the selected issues can take this change.`); return false; }
    const byId = new Map(items.map((item) => [item.task.id, item]));
    setRaw((current) => current.map((t) => (byId.has(t.id) ? { ...t, ...byId.get(t.id).patch } : t)));
    const failed = [];
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        try {
          await store.patchTask(item.task.id, item.patch, session);
        } catch (e) {
          failed.push({ id: item.task.id, message: formatError(e) });
          const previous = Object.fromEntries(Object.keys(item.patch).map((k) => [k, item.task[k]]));
          setRaw((current) => rollbackTaskPatch(current, item.task.id, previous));
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, items.length) }, worker));
    refreshEvents();
    const saved = items.length - failed.length;
    if (failed.length) flash('error', `${label}: ${saved} saved, ${failed.length} not saved (${failed.slice(0, 3).map((f) => `${f.id}: ${f.message}`).join('; ')}${failed.length > 3 ? '; …' : ''}).`);
    else flash('ok', `${label}: ${saved} issue(s) updated.`);
    return failed.length === 0;
  }
  function bulkApply(ids, field, value) {
    const v = String(value ?? '').trim();
    const openIds = ids.filter((id) => {
      const task = rawById.get(id);
      return task && !task.closed && String(task.sourceStatus || '').toLowerCase() !== 'closed';
    });
    if (openIds.length !== ids.length) flash('error', 'Closed issues cannot be bulk-edited. Reopen them first.');
    if (!openIds.length) return false;
    if (field === 'remark') {
      return bulkUpdate(openIds, (t) => ({ remark: t.remark ? `${t.remark}\n${v}` : v }), 'Remarks added');
    }
    if (field === 'owner') {
      return bulkUpdate(openIds, (t) => (t.owner === v ? null : { owner: v || 'Unassigned' }), 'Owner changed');
    }
    if (field === 'dept') return bulkUpdate(openIds, (t) => (t.dept === v ? null : { dept: v }), 'Department changed');
    if (field === 'due' || field === 'next') {
      const name = field === 'due' ? 'Target date' : 'Next date';
      return bulkUpdate(openIds, (t) => ((t.closed || String(t.sourceStatus || '').toLowerCase() === 'closed') || (t[field] ?? '') === v ? null : { [field]: v || null }), `${name} changed`);
    }
    return false;
  }
  function bulkClose(ids) {
    const message = session.role === 'Owner'
      ? `Close ${ids.length} issue(s)? Your manager will check the proof and can reopen any of them.`
      : `Confirm that you reviewed the proof of ${ids.length} issue(s) and want to close them?`;
    if (!window.confirm(message)) return false;
    return bulkUpdate(ids, (t) => (t.closed ? null : { closed: fmtDate(today) }), 'Closed');
  }
  function bulkReopen(ids) {
    if (!window.confirm(`Reopen ${ids.length} issue(s) and send them back to their owners?`)) return false;
    return bulkUpdate(ids, (t) => (t.status === 'Closed' ? { closed: null, sourceStatus: 'Open' } : null), 'Reopened');
  }
  async function deleteMany(ids) {
    const tasksToDelete = ids.map((id) => rawById.get(id)).filter(Boolean);
    if (!tasksToDelete.length) return false;
    const proofCount = tasksToDelete.reduce((n, t) => n + (t.proofs || []).length, 0);
    const what = tasksToDelete.length === 1 ? `${tasksToDelete[0].id} — ${tasksToDelete[0].program}` : `${tasksToDelete.length} issues`;
    if (!window.confirm(`Permanently delete ${what}? This cannot be undone.${proofCount ? ` ${proofCount} attached proof file(s) will also be deleted.` : ''}`)) return false;
    const idsToDelete = tasksToDelete.map((task) => task.id);
    setRaw((current) => current.filter((item) => !idsToDelete.includes(item.id)));
    try {
      await store.deleteTasks(idsToDelete, session);
      await reload();
      flash('ok', tasksToDelete.length === 1 ? `Issue ${tasksToDelete[0].id} was permanently deleted.` : `${tasksToDelete.length} issues were permanently deleted.`);
      return true;
    } catch (error) {
      if (!(await reload())) setRaw((current) => [...current, ...tasksToDelete.filter((task) => !current.some((item) => item.id === task.id))]);
      flash('error', `Could not delete the selected issues: ${formatError(error)}`);
      return false;
    }
  }

  if (supabaseConfigIncomplete) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-brembo-paper">
        <div className="glass-panel rounded-2xl max-w-lg w-full p-7">
          <div className="text-brembo-red text-[11px] uppercase tracking-[.18em] font-bold mb-3">Configuration required</div>
          <h1 className="font-display text-2xl font-bold mb-3">Supabase is only partially configured</h1>
          <p className="text-sm text-brembo-sub leading-6">
            The app is running in secure mode, but one or both Supabase environment values are missing or incomplete. Add both <b className="text-brembo-ink">NEXT_PUBLIC_SUPABASE_URL</b> and <b className="text-brembo-ink">NEXT_PUBLIC_SUPABASE_ANON_KEY</b> to <b className="text-brembo-ink">.env.local</b> before continuing.
          </p>
          <div className="mt-4 rounded-lg border border-brembo-line bg-brembo-panel2 px-3 py-2 text-xs text-brembo-sub">
            Demo mode is still available when both values are empty.
          </div>
        </div>
      </div>
    );
  }
  if (!authReady) return <div className="min-h-screen flex items-center justify-center text-brembo-sub text-sm">Loading…</div>;
  if (recovery) return <SetPassword onDone={() => setRecovery(false)} />;
  if (!session && entryStep === 'landing') {
    return <LandingScreen onContinue={() => setEntryStep('auth')} />;
  }
  if (!session && entryStep === 'auth') {
    return (
      <div className="min-h-screen">
        <AuthScreen onLogin={handleLogin} />
        {sessionError && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[min(92vw,520px)] bg-brembo-red/10 border border-brembo-red/40 text-[#9b1224] text-xs rounded-lg px-3 py-2 shadow-defined">
            {sessionError}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-brembo-paper text-brembo-ink">
      <Sidebar
        session={session}
        activeView={activeView}
        onNavigate={(v) => { setActiveView(v); setSidebarOpen(false); }}
        managers={managers}
        teamMembers={teamMembers}
        viewAsManager={viewAsManager}
        onSelectManager={(name) => { setViewAsManager((cur) => (cur === name ? null : name)); setActiveView('dashboard'); }}
        onLogout={handleLogout}
        hiddenTabs={store.mode === 'supabase' ? [] : ['lists']}
        badges={{ morning: myEscalationCount }}
        open={sidebarOpen}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar visibleTasks={scopedTasks} events={events} session={session} onOpenTask={(id) => setHistoryTask(tasks.find((t) => t.id === id) || null)} onMenuToggle={() => setSidebarOpen((o) => !o)} />
        <div className="flex-1 overflow-auto px-4 md:px-6 py-5 pb-10">
          {notice && (
            <div className={`print:hidden text-xs px-3 py-2 rounded-md mb-4 flex justify-between gap-3 border ${notice.type === 'error' ? 'bg-brembo-red/10 border-brembo-red/30 text-[#9b1224]' : 'bg-brembo-green/10 border-brembo-green/30 text-[#146b38]'}`}>
              <span>{notice.text}</span>
              <button onClick={() => setNotice(null)} aria-label="Dismiss">✕</button>
            </div>
          )}
          {session.role === 'Admin' && viewAsManager && (
            <div className="print:hidden bg-brembo-reddim border border-brembo-red text-white text-xs px-3 py-2 rounded-md mb-4">
              Admin view — inspecting {viewAsTracker ? `${viewAsManager}'s tracker` : `${viewAsManager}'s assigned issues`} ({scopedTasks.length} issues)
            </div>
          )}
          {loading && <div className="print:hidden text-brembo-sub text-[13px] mb-4">Loading issues…</div>}
          {!loading && scopedTasks.length === 0 && (
            <div className="bg-white border border-brembo-line text-brembo-sub text-[13px] px-4 py-3 rounded-md mb-4 shadow-card">
              {session.role === 'Owner'
                ? 'No issues are assigned to you yet. They appear here as soon as a Platform Manager assigns one to your name.'
                : 'No issues to show in this view yet. If a tracker should be here, import it (see SETUP.md).'}
            </div>
          )}
          {activeView === 'dashboard' && <Dashboard scopedTasks={scopedTasks} filters={filters} setFilters={setFilters} loading={loading} redFlagCount={redFlagCount} onOpenTask={openTaskInRegister} />}
          {activeView === 'morning' && <MorningUpdate tasks={scopedTasks} session={session} onSetSerial={canEditIssue ? (id, srNo) => patch(id, { srNo }) : undefined} onOpenTask={openTaskInRegister} />}
          {activeView === 'report' && (
            <WeeklyReport
              tasks={scopedTasks}
              session={session}
              today={today}
              scopeLabel={session.role === 'Admin' ? (viewAsManager ? (viewAsTracker ? `${viewAsManager}'s tracker` : `Issues assigned to ${viewAsManager}`) : 'All trackers') : session.role === 'Manager' ? `${session.name}'s tracker` : `Issues of ${session.display || session.name}`}
            />
          )}
          {(activeView === 'register' || activeView === 'closed') && (
            <TaskRegister
              tasks={scopedTasks}
              session={session}
              managers={managers}
              departments={departmentChoices}
              employees={employees}
              today={today}
              savedViews={savedViews}
              onSaveView={saveView}
              onDeleteView={deleteView}
              onAddIssue={canAddIssue ? () => setAddOpen(true) : undefined}
              onImportExcel={canAddIssue ? () => setImportOpen(true) : undefined}
              onDeleteMany={canDeleteIssue ? deleteMany : undefined}
              onEditTask={canEditIssue ? openEditTask : undefined}
              onPatchTask={canEditIssue ? patch : undefined}
              onBulkApply={canEditIssue ? bulkApply : undefined}
              onBulkClose={bulkClose}
              onBulkReopen={bulkReopen}
              onShowHistory={setHistoryTask}
              showArchived={showArchived}
              archivedCount={archivedCount}
              onToggleArchived={store.loadArchivedTasks ? toggleArchived : undefined}
              onAddProof={addProof}
              onRemoveProof={removeProof}
              onSetRemark={setRemark}
              onSetDue={setDue}
              onSetNextDate={setNextDate}
              onSetDueAcceptance={setDueAcceptance}
              onSetOwner={setOwner}
              onToggleRedFlag={toggleRedFlag}
              onClose={closeIssue}
              onReopen={reopen}
              onViewProof={viewProof}
              closedOnly={activeView === 'closed'}
              navigationRequest={taskNavigation}
              onNavigationHandled={clearTaskNavigation}
              onShowClosedIssues={() => setActiveView('closed')}
              onShowActiveRegister={() => setActiveView('register')}
            />
          )}
          {activeView === 'proofs' && <UploadedProofs tasks={scopedTasks} session={session} onViewProof={viewProof} onRemoveProof={removeProof} onSetRemark={setRemark} onClose={closeIssue} onReopen={reopen} onError={(text) => flash('error', text)} />}
          {activeView === 'lists' && session.role === 'Admin' && <Lists store={store} onChanged={listsChanged} onError={(text) => flash('error', text)} onDone={(text) => flash('ok', text)} />}
          {activeView === 'people' && canManagePeople && <People session={session} employees={employees} tasks={scopedTasks} departments={departmentChoices || []} onSave={saveEmployee} onDelete={deleteEmployee} onRename={renameOwner} onSaveDepartment={saveDepartment} />}
          {activeView === 'sop' && <Sop />}
        </div>
      </div>
      {addOpen && canAddIssue && (
        <AddIssueModal session={session} managers={trackerChoices} departments={departmentChoices} employees={employees} defaultManager={viewAsTracker} tasks={raw} onSubmit={addIssue} onClose={() => setAddOpen(false)} />
      )}
      {importOpen && canAddIssue && (
        <ImportExcelModal session={session} managers={trackerChoices} defaultManager={viewAsTracker} tasks={raw} onApply={importExcel} onClose={() => setImportOpen(false)} />
      )}
      {editTask && canEditIssue && (
        <AddIssueModal session={session} managers={trackerChoices} departments={departmentChoices} employees={employees} tasks={raw} task={editTask} onSubmit={saveIssueEdits}
          onCloseIssue={['Manager', 'Admin', 'Owner'].includes(session.role) ? closeIssue : undefined}
          onReopenIssue={['Manager', 'Admin'].includes(session.role) ? reopen : undefined}
          onSendRemark={sendRemark}
          liveKey={events}
          onViewProof={viewProof}
          onClose={() => setEditTask(null)} />
      )}
      {historyTask && <IssueHistory task={historyTask} session={session} employees={employees} liveKey={events} onComment={addComment} onEditComment={editComment} onClose={() => setHistoryTask(null)} />}
      {viewer && <ProofViewer proof={viewer.proof} task={viewer.task} onClose={() => setViewer(null)} />}
    </div>
  );
}
