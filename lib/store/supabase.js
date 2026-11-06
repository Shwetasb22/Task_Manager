// PRODUCTION store: Supabase Auth + Postgres (row level security) + private Storage.
// supabase-js is loaded lazily so demo mode does not need it at runtime.
import { createUuid, mimeFor, safeName } from '../proofs';
import { normalizeDepartment } from '../departments';
import { sortNewestFirst } from '../issues';
import { planSync, applySync, chunk } from '../sync';
import { readCache, writeCache, clearCache } from './cache';
import { databaseError } from '../errors';

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; // anon / publishable key: safe in the browser, RLS protects the data
const BUCKET = 'proofs';
const PAGE = 1000;
const ROLE = { admin: 'Admin', dept_head: 'Dept Head', manager: 'Manager', owner: 'Owner' };
const OWNER_EMAIL_PATTERN = /^[^\s@]+@bremboindia\.com$/i;

let clientPromise;
function sb() {
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(URL_, KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
    );
  }
  return clientPromise;
}

const mapProof = (p) => ({ id: p.id, name: p.filename, mime: p.mime, size: p.size, path: p.path, at: p.created_at, by: p.uploaded_name, byId: p.uploaded_by });
const mapTask = (r) => {
  let source = r.custom || {};
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch { source = {}; }
  }
  return {
  id: r.id, srNo: source.sr_no ?? r.id?.match(/(?:^|-)(\d+)$/)?.[1] ?? r.id, manager: r.manager, program: r.program, desc: r.description, dept: r.dept || 'Unassigned', customer: r.customer || '', owner: r.owner,
  member: r.member || '', initialManager: r.initial_manager || r.manager, start: r.start_date, due: r.due_date, next: r.next_date, closed: r.closed_date,
  remark: r.remark || '', sourceStatus: source.status || '', sourceRgy: source.rgy || '', sourceEscalationLevel: source.escalation_level || '', createdAt: r.created_at, updatedAt: r.updated_at,
  redFlag: r.red_flag === true, dueAcceptance: r.due_acceptance || null, dueProposedAt: r.due_proposed_at || null, dueAcceptedAt: r.due_accepted_at || null,
  proofs: (r.proofs || []).map(mapProof)
    .sort((a, b) => String(a.at).localeCompare(String(b.at))),
  };
};
const COLS = {
  due: 'due_date', next: 'next_date', closed: 'closed_date', remark: 'remark', owner: 'owner',
  program: 'program', desc: 'description', dept: 'dept', customer: 'customer', start: 'start_date',
  member: 'member', manager: 'manager', initialManager: 'initial_manager', redFlag: 'red_flag',
  dueAcceptance: 'due_acceptance', dueProposedAt: 'due_proposed_at', dueAcceptedAt: 'due_accepted_at',
};

const BASE_TASK_COLUMNS = 'id, manager, program, description, dept, customer, owner, member, start_date, due_date, next_date, closed_date, remark, custom, created_at, updated_at';
const EXTRA_TASK_COLUMNS = ', initial_manager, red_flag, due_acceptance, due_proposed_at, due_accepted_at';
let TASK_COLUMNS = BASE_TASK_COLUMNS + EXTRA_TASK_COLUMNS;
const isTrackerColumnError = (error) => /initial_manager|red_flag|due_acceptance|due_proposed_at|due_accepted_at/.test(`${error?.message || ''} ${error?.details || ''}`);
const PROOF_COLUMNS = 'proofs(id, filename, mime, size, path, created_at, uploaded_name, uploaded_by)';

function employeeDirectoryError(error) {
  if (error?.code === 'PGRST205' && /employees/i.test(`${error.message || ''} ${error.details || ''}`)) {
    return Object.assign(new Error('The employee directory table is missing from Supabase. Apply the migrations in order, including 0015_employees.sql and 0025_assignment_import_roles.sql, then reload the schema cache.'), {
      code: error.code,
      details: error.details,
    });
  }
  return databaseError(error);
}

// Archived issues (closed over a year ago, migration 0022) are left out unless asked for.
// An older database has no archived_at column; then every issue is loaded as before.
let archiveColumn = true;
const live = (q) => (archiveColumn ? q.is('archived_at', null) : q);
const isArchiveColumnError = (error) => /archived_at/.test(`${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`);

async function fullLoad(c) {
  const rows = [];
  let columns = TASK_COLUMNS;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await live(c.from('tasks')
      .select(`${columns}, ${PROOF_COLUMNS}`))
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, from + PAGE - 1);
    if (error && archiveColumn && isArchiveColumnError(error)) {
      archiveColumn = false;
      from -= PAGE;
      continue;
    }
    if (error && isTrackerColumnError(error) && columns.includes('red_flag')) {
      TASK_COLUMNS = BASE_TASK_COLUMNS;
      columns = BASE_TASK_COLUMNS;
      from -= PAGE;
      continue;
    }
    if (error && columns.includes('customer') && /column .*customer.*does not exist|tasks\.customer/i.test(error.message || '')) {
      columns = columns.replace(' customer,', '');
      from -= PAGE;
      continue;
    }
    if (error) throw new Error(error.message);
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

// Ids and change times are small; full rows are fetched only for what is new or changed.
async function quickLoad(c, cachedRows) {
  const stamps = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await live(c.from('tasks').select('id, updated_at')).order('id').range(from, from + PAGE - 1);
    if (error && archiveColumn && isArchiveColumnError(error)) {
      archiveColumn = false;
      from -= PAGE;
      continue;
    }
    if (error) throw new Error(error.message);
    stamps.push(...data);
    if (data.length < PAGE) break;
  }
  const plan = planSync(cachedRows, stamps);
  const fetched = [];
  for (const ids of chunk(plan.fetchIds, 150)) {
    const { data, error } = await live(c.from('tasks').select(`${TASK_COLUMNS}, ${PROOF_COLUMNS}`)).in('id', ids);
    if (error) throw new Error(error.message);
    fetched.push(...data);
  }
  return applySync(plan.keep, fetched);
}

async function toSession(user) {
  const c = await sb();
  const { data: p, error } = await c.from('profiles').select('*').eq('id', user.id).single();
  if (error || !p) throw new Error('Your account has no profile yet. Contact your admin.');
  const role = ROLE[p.role] || 'Owner';
  const scopeName = role === 'Manager' ? p.manager_name : role === 'Owner' ? p.owner_name : p.name;
  return {
    id: user.id, email: p.email, display: p.name, role, name: role === 'Owner' ? scopeName || p.name : scopeName || p.name,
    dept: role === 'Admin' ? 'All' : p.department || '', pending: role === 'Manager' && !scopeName,
    canEditOwnerNames: role === 'Dept Head' || p.can_edit_owner_names === true,
    // Every spelling of this owner's name the database matches against the tracker Owner column (0014).
    aliases: role === 'Owner' ? (p.owner_aliases || []) : [],
    // Morning alert email on/off (migration 0016); undefined on an older database.
    notifyDaily: p.notify_daily === undefined ? undefined : p.notify_daily !== false,
  };
}

export const supabaseStore = {
  mode: 'supabase',

  async getSession() {
    const c = await sb();
    const { data } = await c.auth.getSession();
    return data.session ? toSession(data.session.user) : null;
  },
  async signIn(email, password) {
    const c = await sb();
    const { data, error } = await c.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong Outlook ID or password.' : error.message);
    return toSession(data.user);
  },
  async signUp({ name, email, password, department }) {
    const normalizedEmail = email.trim();
    if (!OWNER_EMAIL_PATTERN.test(normalizedEmail)) {
      throw new Error('Owner sign-up is only available with an @bremboindia.com email address.');
    }
    const c = await sb();
    const { data, error } = await c.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: { name, owner_name: name, department: department || null },
        emailRedirectTo: typeof window !== 'undefined' ? `${window.location.origin}/` : undefined,
      },
    });
    if (error) {
      if (/database error saving new user/i.test(error.message || '')) {
        throw new Error('The account could not be created. Check that you entered your full name and an @bremboindia.com email address.');
      }
      throw new Error(error.message);
    }

    if (data.session) return toSession(data.user);
    throw new Error('Account created. Complete email confirmation before signing in.');
  },
  async signOut() {
    const c = await sb();
    await clearCache();
    await c.auth.signOut();
  },
  async resetPassword(email) {
    const c = await sb();
    const { error } = await c.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    if (error) throw new Error(error.message);
  },
  async updatePassword(password) {
    const c = await sb();
    const { error } = await c.auth.updateUser({ password });
    if (error) throw new Error(error.message);
  },
  onAuthEvent(cb) {
    let unsub = () => {};
    let dead = false;
    sb().then((c) => {
      if (dead) return;
      const { data } = c.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT') clearCache();
        cb(event);
      });
      unsub = () => data.subscription.unsubscribe();
    });
    return () => { dead = true; unsub(); };
  },

  // Live updates (already filtered by row level security). Each database change is turned into a
  // small change object (see lib/live.js) so screens update one issue instead of reloading all.
  subscribe(onChange, profileId) {
    let ch; let dead = false; let client;
    const taskChange = (payload) => (payload.eventType === 'DELETE'
      ? { type: 'delete', id: payload.old?.id }
      : { type: 'upsert', task: mapTask(payload.new || {}) });
    const proofChange = (payload) => (payload.eventType === 'DELETE'
      ? { type: 'proof-removed', proofId: payload.old?.id }
      : { type: 'proof-added', taskId: payload.new?.task_id, proof: mapProof(payload.new || {}) });
    sb().then((c) => {
      if (dead) return;
      client = c;
      ch = c.channel('brembo-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, (p) => onChange(taskChange(p)))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'proofs' }, (p) => onChange(proofChange(p)))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'employees' }, () => onChange({ type: 'employees' }))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'departments' }, () => onChange({ type: 'departments' }))
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'task_comments' }, (p) => onChange({ type: 'comment', taskId: p.new?.task_id }));
      if (profileId) {
        ch.on('postgres_changes', {
          event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${profileId}`,
        }, () => onChange({ type: 'profile' }));
      }
      ch.subscribe();
    });
    return () => { dead = true; if (ch && client) client.removeChannel(ch); };
  },

  // First visit: every issue, in pages so the app keeps working past PostgREST's 1000-row cap.
  // Later visits and refreshes: only issues added or changed since the copy kept in this browser.
  async loadTasks() {
    const c = await sb();
    const { data } = await c.auth.getSession();
    const uid = data.session?.user?.id;
    let rows = null;
    const cached = uid ? await readCache(uid) : null;
    if (cached) {
      try {
        rows = await quickLoad(c, cached);
      } catch {
        rows = null; // e.g. an older database: fall back to the full download
      }
    }
    if (!rows) rows = await fullLoad(c);
    if (uid) writeCache(uid, rows);
    return sortNewestFirst(rows.map(mapTask));
  },
  // Archived issues, fetched only when someone ticks "Show archived" (not kept in the browser copy).
  async loadArchivedTasks() {
    if (!archiveColumn) return [];
    const c = await sb();
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await c.from('tasks').select(`${TASK_COLUMNS}, ${PROOF_COLUMNS}`)
        .not('archived_at', 'is', null).order('closed_date', { ascending: false }).order('id').range(from, from + PAGE - 1);
      if (error) {
        if (isArchiveColumnError(error)) return [];
        throw new Error(error.message);
      }
      rows.push(...data);
      if (data.length < PAGE) break;
    }
    return rows.map((r) => ({ ...mapTask(r), archived: true }));
  },
  async archiveCandidates(days = 365) {
    const c = await sb();
    const { data, error } = await c.rpc('archive_candidates', { p_days: days });
    if (error) return null;
    return Number(data || 0);
  },
  async archiveNow(days = 365) {
    const c = await sb();
    const { data, error } = await c.rpc('archive_closed_tasks', { p_days: days });
    if (error) throw new Error(error.message);
    return Number(data || 0);
  },

  // Every tracker an issue can be filed under (migration 0014). Falls back to manager profiles
  // the person can read when the database has not been updated yet.
  async listManagers() {
    const c = await sb();
    const rpc = await c.rpc('list_trackers');
    if (!rpc.error) return (rpc.data || []).map((r) => (typeof r === 'string' ? r : r.list_trackers)).filter(Boolean);
    const { data } = await c.from('profiles').select('manager_name').eq('role', 'manager');
    return (data || []).map((r) => r.manager_name).filter(Boolean);
  },

  // Department codes offered in the app (migration 0021). Empty on an older database.
  async listDepartments() {
    const c = await sb();
    const { data, error } = await c.from('departments').select('code, name, active').order('code');
    return error ? [] : data || [];
  },
  // Admin "Lists" page: trackers and departments with how many issues use each.
  async listLists() {
    const c = await sb();
    const [trackers, departments, usage] = await Promise.all([
      c.from('trackers').select('name, active').order('name'),
      c.from('departments').select('code, name, active').order('code'),
      c.rpc('list_usage'),
    ]);
    const err = trackers.error || departments.error || usage.error;
    if (err) throw new Error(/trackers|departments|list_usage/.test(err.message || '') ? 'Lists need the 0021_lists.sql database update. Ask the admin to run it.' : err.message);
    const count = (kind, name) => (usage.data || []).find((u) => u.kind === kind && u.name === name) || { issues: 0, open_issues: 0 };
    return {
      trackers: trackers.data.map((t) => ({ ...t, issues: Number(count('tracker', t.name).issues), open: Number(count('tracker', t.name).open_issues) })),
      departments: departments.data.map((d) => ({ ...d, issues: Number(count('department', d.code).issues), open: Number(count('department', d.code).open_issues) })),
    };
  },
  async renameTracker(from, to) {
    const c = await sb();
    const { data, error } = await c.rpc('rename_tracker', { p_from: from, p_to: to });
    if (error) throw databaseError(error);
    return Number(data || 0);
  },
  async setTrackerActive(name, active) {
    const c = await sb();
    const { error } = await c.from('trackers').update({ active }).eq('name', name);
    if (error) throw databaseError(error);
  },
  async saveDepartment(dept) {
    const c = await sb();
    const { error } = await c.from('departments').upsert({ code: dept.code.trim(), name: dept.name ? dept.name.trim() : null, active: dept.active !== false });
    if (error) throw databaseError(error);
  },
  async mergeDepartment(from, to) {
    const c = await sb();
    const { data, error } = await c.rpc('merge_department', { p_from: from, p_to: to });
    if (error) throw databaseError(error);
    return Number(data || 0);
  },

  async setDailyEmail(on) {
    const c = await sb();
    const { error } = await c.rpc('set_daily_email', { p_on: Boolean(on) });
    if (error) throw databaseError(error);
    return Boolean(on);
  },

  // The signed-in person's saved Task Register views (migration 0017). Empty on an older database.
  async listViews() {
    const c = await sb();
    const { data, error } = await c.from('saved_views').select('id, name, filters').order('name');
    if (error) return [];
    return data || [];
  },
  async saveView(name, filters) {
    const c = await sb();
    const { data, error } = await c.from('saved_views').insert({ name, filters }).select('id, name, filters').single();
    if (error) {
      if (error.code === '23505') throw Object.assign(new Error(`You already have a view called "${name}".`), { code: error.code, details: error.details });
      throw databaseError(error);
    }
    return data;
  },
  async deleteView(id) {
    const c = await sb();
    const { error } = await c.from('saved_views').delete().eq('id', id);
    if (error) throw databaseError(error);
  },

  // Everyone who can own an issue (migration 0015). Empty when the database is older.
  async listEmployees() {
    const c = await sb();
    const { data, error } = await c.from('employees').select('id, name, email, department, active').order('name');
    if (error) throw employeeDirectoryError(error);
    return data || [];
  },
  async saveEmployee(emp) {
    const c = await sb();
    const row = { name: emp.name, email: emp.email || null, department: emp.department || null, active: emp.active !== false };
    const res = emp.id
      ? await c.from('employees').update(row).eq('id', emp.id).select('id, name, email, department, active').single()
      : await c.from('employees').insert(row).select('id, name, email, department, active').single();
    if (res.error) {
      if (res.error.code === '23505') throw Object.assign(new Error(`${emp.name} or that Outlook ID is already on the list.`), { code: res.error.code, details: res.error.details });
      if (/row-level security/i.test(res.error.message || '')) {
        throw Object.assign(new Error('Only admins, dept heads and managers can change the employee list.'), { code: res.error.code, details: res.error.details });
      }
      throw employeeDirectoryError(res.error);
    }
    return res.data;
  },
  async deleteEmployee(id) {
    const c = await sb();
    const { data, error } = await c.from('employees').delete().eq('id', id).select('id');
    if (error) throw employeeDirectoryError(error);
    if (!data || !data.length) throw new Error('Only an admin can remove someone from the list. You can mark them inactive instead.');
  },
  // Changes one owner spelling to another in every issue the person may edit; returns how many changed.
  async renameOwner(from, to) {
    const c = await sb();
    const { data, error } = await c.rpc('rename_owner', { p_from: from, p_to: to });
    if (error) throw databaseError(error);
    return data || 0;
  },

  // Recent audit-trail events the user may see (RLS: same visibility as the issue).
  async listEvents(limit = 300) {
    const c = await sb();
    const { data, error } = await c.from('task_events')
      .select('id, task_id, actor, actor_name, action, detail, at')
      .order('at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return data || [];
  },

  async listTaskHistory(taskId) {
    const c = await sb();
    const [{ data, error }, { data: assignments, error: assignmentError }] = await Promise.all([
      c.from('task_events')
      .select('id, task_id, actor, actor_name, action, detail, at')
      .eq('task_id', taskId)
      .order('at', { ascending: false }),
      c.from('assignment_history')
        .select('id, task_id, from_person, to_person, changed_by, changed_by_name, changed_at')
        .eq('task_id', taskId)
        .order('changed_at', { ascending: false }),
    ]);
    if (error) throw databaseError(error);
    if (assignmentError) throw databaseError(assignmentError);
    const history = (assignments || []).map((row) => ({
      id: `assignment-${row.id}`,
      task_id: row.task_id,
      actor: row.changed_by,
      actor_name: row.changed_by_name,
      action: 'update',
      detail: { owner: { from: row.from_person, to: row.to_person } },
      at: row.changed_at,
    }));
    return [...(data || []), ...history].sort((a, b) => String(b.at).localeCompare(String(a.at)));
  },

  async autoAcceptDueDates() {
    const c = await sb();
    const { data, error } = await c.rpc('auto_accept_due_dates');
    if (error) {
      if (error.code !== 'PGRST202' && !/auto_accept_due_dates/i.test(error.message || '')) throw databaseError(error);
      return 0; // older database without the function: nothing changed
    }
    // Number of issues switched to auto-accepted; null/unknown means "assume something changed".
    return Number.isFinite(Number(data)) ? Number(data) : 1;
  },

  async getRedFlagCount() {
    const c = await sb();
    const { data, error } = await c.rpc('red_flag_count');
    if (error) {
      if (error.code === 'PGRST202' || /red_flag_count/i.test(error.message || '')) return null;
      throw databaseError(error);
    }
    return Number(data || 0);
  },

  async updateComment(commentId, text, mentions = []) {
    const c = await sb();
    const { error } = await c.from('task_comments').update({ body: text, mentions }).eq('id', commentId);
    if (error) throw databaseError(error);
  },

  // A comment on an issue (RLS: anyone who can see the issue). Author and name are set by the database.
  async addComment(taskId, text, mentions = []) { // session is not needed: the database knows who is signed in
    const c = await sb();
    const { error } = await c.from('task_comments').insert({ task_id: taskId, body: text, mentions });
    if (error) {
      if (/task_comments/.test(error.message || '') && /does not exist|schema cache/i.test(error.message || '')) {
        throw Object.assign(new Error('Comments need the 0018_comments.sql database update. Ask the admin to run it.'), {
          code: error.code,
          details: error.details,
        });
      }
      throw databaseError(error);
    }
  },

  async listProofEvents() {
    const c = await sb();
    const { data, error } = await c.from('task_events')
      .select('id, task_id, actor_name, detail, at')
      .eq('action', 'proof_added')
      .order('at', { ascending: false })
      .limit(50);
    if (error) throw databaseError(error);
    return data || [];
  },

  // Adds an issue. The database assigns the id (e.g. SI-205), enforces who may add where, and
  // Realtime then pushes the new row to everyone who is allowed to see it.
  async addTask(issue, session) {
    if (session?.role !== 'Manager' || session.pending) {
      throw new Error('Only a Platform Manager can create a new issue.');
    }
    const c = await sb();
    const row = {
      ...(issue.id ? { id: issue.id } : {}),
      manager: issue.manager,
      program: issue.program,
      description: issue.desc,
      dept: normalizeDepartment(issue.dept),
      customer: issue.customer || '',
      owner: issue.owner,
      member: issue.member || null,
      initial_manager: issue.initialManager || issue.manager,
      start_date: issue.start || null,
      due_date: issue.due || null,
      next_date: issue.next || null,
      remark: issue.remark || null,
      closed_date: issue.closed || null,
      due_acceptance: issue.due ? 'pending' : null,
      due_proposed_at: issue.due ? new Date().toISOString() : null,
      custom: issue.sourceStatus ? { status: issue.sourceStatus } : {},
    };
    const cols = `${BASE_TASK_COLUMNS.replace(', updated_at', '')}${EXTRA_TASK_COLUMNS}`;
    let res = await c.from('tasks').insert(row).select(cols).single();
    if (res.error && isTrackerColumnError(res.error)) {
      delete row.initial_manager;
      delete row.due_acceptance;
      delete row.due_proposed_at;
      res = await c.from('tasks').insert(row).select(BASE_TASK_COLUMNS.replace(', updated_at', '')).single();
    }
    if (res.error && /customer/i.test(res.error.message || '')) {
      // Older database without migration 0008: retry without the customer column.
      delete row.customer;
      res = await c.from('tasks').insert(row).select(cols.replace('customer, ', '')).single();
    }
    if (res.error) {
      if (/row-level security/i.test(res.error.message || '')) {
        throw Object.assign(new Error('You are not allowed to add this issue to the selected tracker.'), { code: res.error.code, details: res.error.details });
      }
      throw databaseError(res.error);
    }
    return mapTask(res.data);
  },

  // Whole Excel sheet in one request, all or nothing (migration 0020). Returns null on an older
  // database without the function, so the caller can save row by row instead.
  async importTasks(manager, adds, updates) {
    const c = await sb();
    const { data, error } = await c.rpc('import_tasks', { p_manager: manager, p_adds: adds, p_updates: updates });
    if (error) {
      if (error.code === 'PGRST202' || (/import_tasks/i.test(error.message || '') && /schema cache|does not exist/i.test(error.message || ''))) return null;
      if (/row-level security/i.test(error.message || '')) {
        throw databaseError(error);
      }
      throw databaseError(error);
    }
    return { added: Number(data?.added || 0), updated: Number(data?.updated || 0) };
  },

  async patchTask(id, patch) {
    const c = await sb();
    const body = {};
    Object.keys(patch).forEach((k) => { if (COLS[k]) body[COLS[k]] = patch[k] === '' ? null : patch[k]; });
    if (Object.prototype.hasOwnProperty.call(patch, 'sourceStatus') || Object.prototype.hasOwnProperty.call(patch, 'srNo')) {
      const { data: current, error: readError } = await c.from('tasks').select('custom').eq('id', id).single();
      if (readError) throw databaseError(readError);
      const custom = { ...(current.custom || {}) };
      if (Object.prototype.hasOwnProperty.call(patch, 'sourceStatus')) custom.status = patch.sourceStatus || null;
      if (Object.prototype.hasOwnProperty.call(patch, 'srNo')) custom.sr_no = patch.srNo === '' ? null : patch.srNo;
      body.custom = custom;
    }
    const { data, error } = await c.from('tasks').update(body).eq('id', id).select('id');
    if (error && /row-level security/i.test(error.message || '')) {
      throw Object.assign(new Error('You are not allowed to update this issue.'), { code: error.code, details: error.details });
    }
    if (error) throw databaseError(error);
    if ((!data || data.length === 0) && !Object.prototype.hasOwnProperty.call(patch, 'owner')) {
      throw new Error('This change was not saved. The issue may no longer be visible to your account.');
    }
  },

  async deleteTasks(ids) {
    const selectedIds = [...new Set(ids)].filter(Boolean);
    if (!selectedIds.length) return [];
    const c = await sb();
    const paths = [];
    for (const batch of chunk(selectedIds, 500)) {
      const { data, error } = await c.from('proofs').select('path').in('task_id', batch);
      if (error)       throw databaseError(error);
      paths.push(...(data || []).map((proof) => proof.path));
    }
    for (const batch of chunk(paths, 500)) {
      const { error: storageError } = await c.storage.from(BUCKET).remove(batch);
      if (storageError) {
        throw Object.assign(new Error(`Could not remove attached proof files, so the issues were kept. ${storageError.message}`), { code: storageError.name, details: storageError.message });
      }
    }

    const deleted = [];
    for (const batch of chunk(selectedIds, 500)) {
      const { data, error } = await c.from('tasks').delete().in('id', batch).select('id');
      if (error) {
        throw Object.assign(new Error(paths.length
          ? `Proof files were removed, but the issues could not be deleted. Ask an administrator to reconcile them. ${error.message}`
          : error.message), { code: error.code, details: error.details });
      }
      deleted.push(...(data || []).map((task) => task.id));
    }
    if (deleted.length !== selectedIds.length) {
      throw new Error(`Only ${deleted.length} of ${selectedIds.length} selected issues were deleted. Check permissions and refresh the register.`);
    }
    return deleted;
  },

  async deleteTask(id) {
    await supabaseStore.deleteTasks([id]);
  },

  async listAllTaskIds() {
    const c = await sb();
    const ids = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await c.from('tasks').select('id').order('id').range(from, from + PAGE - 1);
      if (error) throw databaseError(error);
      ids.push(...(data || []).map((task) => task.id));
      if ((data || []).length < PAGE) break;
    }
    return ids;
  },

  async addProof(taskId, file) {
    const c = await sb();
    const path = `${taskId}/${createUuid()}-${safeName(file.name)}`;
    const mime = file.type || mimeFor(file.name);
    const up = await c.storage.from(BUCKET).upload(path, file, { contentType: mime, upsert: false });
    if (up.error) throw databaseError(up.error);
    const { data, error } = await c.from('proofs')
      .insert({ task_id: taskId, path, filename: file.name, mime, size: file.size })
      .select().single();
    if (error) {
      const { error: cleanupError } = await c.storage.from(BUCKET).remove([path]);
      if (cleanupError) {
        throw Object.assign(new Error(`Proof metadata could not be saved (${error.message}), and the uploaded file could not be removed (${cleanupError.message}). Ask an administrator to reconcile object ${path}.`), {
          code: error.code || cleanupError.code,
          details: [error.details, cleanupError.details].filter(Boolean).join(' · '),
        });
      }
      throw databaseError(error);
    }
    return mapProof(data);
  },

  async removeProof(taskId, proof) {
    const c = await sb();
    const { error: storageError } = await c.storage.from(BUCKET).remove([proof.path]);
    if (storageError) {
      throw Object.assign(new Error(`Could not remove proof file; its metadata was kept. ${storageError.message}`), {
        code: storageError.code,
        details: storageError.details,
      });
    }
    const { data, error } = await c.from('proofs').delete().eq('id', proof.id).select('id');
    if (error) {
      throw Object.assign(new Error(`The proof file was removed, but its metadata could not be deleted. Retry removal or run the proof reconciliation query. ${error.message}`), {
        code: error.code,
        details: error.details,
      });
    }
    if (!data || data.length === 0) {
      throw new Error('The proof file was removed, but its metadata row was not deleted. Check permissions and run the proof reconciliation query.');
    }
  },

  // Short-lived signed URL (5 min) — files are never public.
  async getProofUrl(proof, opts = {}) {
    const c = await sb();
    const { data, error } = await c.storage.from(BUCKET).createSignedUrl(proof.path, 300, opts.download ? { download: proof.name } : undefined);
    if (error) throw databaseError(error);
    return data.signedUrl;
  },
};
