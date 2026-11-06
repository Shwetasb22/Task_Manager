// DEMO / offline store: everything stays in THIS browser (localStorage + IndexedDB for files).
// Used automatically when the Supabase env vars are not set. Same interface as supabase.js.
import seed from '../tasks-seed.json';
import { MANAGERS } from '../data';
import { canRemoveProof, createUuid, mimeFor, validateFile } from '../proofs';
import { normalizeDepartment } from '../departments';
import { nextIssueId, sortNewestFirst } from '../issues';
import { employeesFromOwners, replaceOwnerName, ownerTokens } from '../employees';
import { isOwnerOf } from '../owners';
import { revisedDateError } from '../due-policy';

const EDITS_KEY = 'brembo.edits.v2'; // { [taskId]: { due, next, closed, remark } }
const PROOFS_KEY = 'brembo.proofs.v2'; // { [taskId]: [proofMeta] }
const ADDED_KEY = 'brembo.added.v1'; // [task] issues added from the Add Issue form
const DELETED_KEY = 'brembo.deleted.v1'; // [taskId] removed in this browser's demo data
const EVENTS_KEY = 'brembo.events.v1'; // [event] demo audit trail, same shape as public.task_events
const EMPLOYEES_KEY = 'brembo.employees.v1'; // [employee] demo employee list (filled from the tracker once)
const DEPARTMENTS_KEY = 'brembo.departments.v1';
const VIEWS_KEY = 'brembo.views.v1'; // { [person]: [savedView] } demo saved views

// Same column names as the database audit trail, so the bell and history read both alike.
const EVENT_COLS = {
  due: 'due_date', next: 'next_date', closed: 'closed_date', remark: 'remark', owner: 'owner',
  program: 'program', desc: 'description', dept: 'dept', customer: 'customer', start: 'start_date',
  member: 'member', manager: 'manager', initialManager: 'initial_manager', redFlag: 'red_flag',
  dueAcceptance: 'due_acceptance',
};
function logEvent(taskId, session, action, detail) {
  const events = readList(EVENTS_KEY);
  events.push({
    id: createUuid(), task_id: taskId, actor: session?.id || null,
    actor_name: (session && (session.display || session.name)) || 'You', action, detail, at: new Date().toISOString(),
  });
  write(EVENTS_KEY, events.slice(-1000));
}

const read = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k) || '{}');
  } catch {
    return {};
  }
};
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const readList = (k) => {
  try {
    const v = JSON.parse(localStorage.getItem(k) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('brembo-proofs', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function fileOp(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction('files', mode);
    const req = fn(t.objectStore('files'));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// One issue with its edits and proofs, without sorting the whole list (patches run often).
function findTask(id) {
  if (readList(DELETED_KEY).includes(id)) return null;
  const base = seed.find((t) => t.id === id) || readList(ADDED_KEY).find((t) => t.id === id);
  if (!base) return null;
  return { ...base, dept: base.dept || 'Unassigned', customer: base.customer || '', ...(read(EDITS_KEY)[id] || {}), proofs: read(PROOFS_KEY)[id] || [] };
}

// Who may change an issue (same as the database row level security):
// admins and dept heads any issue, a manager their own tracker, an owner only issues assigned to them.
function canTouch(session, task) {
  if (!session || !task) return false;
  if (session.role === 'Admin' || session.role === 'Dept Head') return true;
  if (session.role === 'Manager') return !session.pending && task.manager === session.name;
  return session.role === 'Owner' && isOwnerOf(session, task);
}
function requireTask(id, session) {
  const task = findTask(id);
  if (!task) throw new Error(`Issue ${id} was not found. Refresh and try again.`);
  if (!canTouch(session, task)) throw new Error('You are not allowed to update this issue.');
  return task;
}

export const localStore = {
  mode: 'local',
  async getSession() { return null; },
  async signIn() { throw new Error('Demo mode: use the quick-login buttons.'); },
  async signUp({ name, email, password }) {
    if (!name || !email || !password) {
      throw new Error('Name, email and password are required.');
    }
    return { name, email, role: 'Owner' };
  },
  async signOut() {},
  async resetPassword() { throw new Error('Not available in demo mode.'); },
  async updatePassword() { throw new Error('Not available in demo mode.'); },
  onAuthEvent() { return () => {}; },
  subscribe() { return () => {}; },

  async loadTasks() {
    const edits = read(EDITS_KEY);
    const proofs = read(PROOFS_KEY);
    const added = readList(ADDED_KEY);
    const deleted = new Set(readList(DELETED_KEY));
    return sortNewestFirst([...seed, ...added].filter((t) => !deleted.has(t.id)).map((t) => ({ ...t, dept: t.dept || 'Unassigned', customer: t.customer || '', ...(edits[t.id] || {}), proofs: proofs[t.id] || [] })));
  },
  async listAllTaskIds() {
    return (await localStore.loadTasks()).map((task) => task.id);
  },
  async listManagers() { return MANAGERS.map((m) => m.name); },
  async getRedFlagCount() { return (await localStore.loadTasks()).filter((task) => task.redFlag === true).length; },
  async listProofEvents() { return []; },
  async listEvents(limit = 300) {
    return readList(EVENTS_KEY).slice(-limit).reverse();
  },
  async addComment(taskId, text, mentions = [], session) {
    const body = String(text || '').trim();
    if (!body) throw new Error('Write a comment first.');
    if (body.length > 2000) throw new Error('A comment can be at most 2000 characters.');
    logEvent(taskId, session, 'comment', { comment_id: createUuid(), text: body, mentions: [...new Set(mentions)].slice(0, 20) });
  },
  async updateComment(commentId, text, mentions = [], session) {
    const body = String(text || '').trim();
    if (!body) throw new Error('Write a comment first.');
    if (body.length > 2000) throw new Error('A comment can be at most 2000 characters.');
    const events = readList(EVENTS_KEY);
    const event = events.find((row) => row.action === 'comment' && String(row.detail?.comment_id) === String(commentId));
    if (!event) throw new Error('That comment was not found.');
    const me = (session && (session.display || session.name)) || null;
    const mine = session?.id && event.actor ? event.actor === session.id : Boolean(me) && event.actor_name === me;
    if (!mine) throw new Error('You can only edit your own comment.');
    const from = event.detail?.text;
    const savedMentions = [...new Set(mentions)].slice(0, 20);
    event.detail = { ...event.detail, text: body, mentions: savedMentions, edited: true };
    write(EVENTS_KEY, events);
    logEvent(event.task_id, session, 'comment_edited', { comment_id: commentId, from, to: body, mentions: savedMentions });
  },
  async autoAcceptDueDates() {
    const edits = read(EDITS_KEY);
    const now = Date.now();
    let changed = 0;
    (await localStore.loadTasks()).forEach((task) => {
      if (task.closed || !task.due || task.dueAcceptance !== 'pending') return;
      const proposed = Date.parse(task.dueProposedAt || '');
      if (!Number.isFinite(proposed) || now - proposed < 3 * 86400000) return;
      edits[task.id] = { ...(edits[task.id] || {}), dueAcceptance: 'auto_accepted', dueAcceptedAt: new Date().toISOString() };
      changed += 1;
    });
    if (changed) write(EDITS_KEY, edits);
    return changed;
  },
  async listTaskHistory(taskId) {
    return readList(EVENTS_KEY).filter((event) => event.task_id === taskId).reverse();
  },

  async setDailyEmail(on) { return Boolean(on); },

  // Demo mode has no managed lists: the app falls back to the departments and trackers in the data.
  async listDepartments() { return readList(DEPARTMENTS_KEY); },
  async saveDepartment(dept, session) {
    if (!session || !['Admin', 'Dept Head', 'Manager'].includes(session.role)) throw new Error('Only admins, dept heads and managers can add departments.');
    const code = String(dept.code || '').trim();
    if (!code) throw new Error('Enter a department code.');
    const departments = readList(DEPARTMENTS_KEY);
    const saved = { code, name: String(dept.name || '').trim() || null, active: true };
    write(DEPARTMENTS_KEY, [...departments.filter((item) => item.code !== code), saved].sort((a, b) => a.code.localeCompare(b.code)));
    return saved;
  },
  async listLists() { throw new Error('Managing trackers and departments needs the database (Supabase). In demo mode the lists come from the data.'); },
  async listViews(session) { return (read(VIEWS_KEY)[session?.name] || []).sort((a, b) => a.name.localeCompare(b.name)); },
  async saveView(name, filters, session) {
    const all = read(VIEWS_KEY);
    const mine = all[session?.name] || [];
    if (mine.some((v) => v.name.trim().toLowerCase() === name.trim().toLowerCase())) throw new Error(`You already have a view called "${name}".`);
    const view = { id: createUuid(), name: name.trim(), filters };
    all[session?.name] = [...mine, view];
    write(VIEWS_KEY, all);
    return view;
  },
  async deleteView(id, session) {
    const all = read(VIEWS_KEY);
    all[session?.name] = (all[session?.name] || []).filter((v) => v.id !== id);
    write(VIEWS_KEY, all);
  },

  async listEmployees() {
    let list = readList(EMPLOYEES_KEY);
    if (!list.length) {
      const owners = (await localStore.loadTasks()).map((t) => t.owner);
      list = employeesFromOwners(owners, MANAGERS.map((m) => ({ name: m.name, email: null, department: m.dept, active: true })))
        .map((e) => ({ ...e, id: createUuid() }));
      write(EMPLOYEES_KEY, list);
    }
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  },
  async saveEmployee(emp, session) {
    if (!session || !['Admin', 'Dept Head', 'Manager'].includes(session.role)) throw new Error('Only admins, dept heads and managers can change the employee list.');
    const list = await localStore.listEmployees();
    const name = String(emp.name || '').replace(/\s+/g, ' ').trim();
    const email = String(emp.email || '').trim().toLowerCase() || null;
    if (!name) throw new Error('Enter a name.');
    const before = emp.id ? list.find((e) => e.id === emp.id) : null;
    if (before && before.name !== name && session.role !== 'Dept Head' && session.canEditOwnerNames !== true) throw new Error('Only a dept head can edit an owner name.');
    const clash = list.find((e) => e.id !== emp.id && (e.name.toLowerCase() === name.toLowerCase() || (email && e.email === email)));
    if (clash) throw new Error(`${name} or that Outlook ID is already on the list.`);
    const saved = { id: emp.id || createUuid(), name, email, department: String(emp.department || '').trim() || null, active: emp.active !== false };
    write(EMPLOYEES_KEY, emp.id ? list.map((e) => (e.id === emp.id ? saved : e)) : [...list, saved]);
    return saved;
  },
  async deleteEmployee(id, session) {
    if (session?.role !== 'Admin') throw new Error('Only an admin can remove someone from the list. You can mark them inactive instead.');
    write(EMPLOYEES_KEY, (await localStore.listEmployees()).filter((e) => e.id !== id));
  },
  async renameOwner(from, to, session) {
    if (!session || (session.role !== 'Dept Head' && session.canEditOwnerNames !== true)) throw new Error('Only a dept head can rename owners.');
    const key = ownerTokens(from)[0];
    const tasks = (await localStore.loadTasks()).filter((t) => (session?.role === 'Admin' || session?.role === 'Dept Head' || t.manager === session?.name)
      && ownerTokens(t.owner).includes(key));
    for (const t of tasks) {
      const owner = replaceOwnerName(t.owner, from, to);
      if (owner !== t.owner) await localStore.patchTask(t.id, { owner }, session);
    }
    return tasks.length;
  },

  async addTask(issue, session) {
    if (session?.role !== 'Manager' || session.pending) throw new Error('Only a Platform Manager can create a new issue.');
    if (issue.manager !== session.name) throw new Error('Platform Managers can only create issues in their own tracker.');
    if (!issue.due) throw new Error('Target date is required.');
    if (!String(issue.program || '').trim()) throw new Error('Program is required.');
    if (!String(issue.desc || '').trim()) throw new Error('Issue description is required.');
    if (issue.start && issue.due < issue.start) throw new Error('Target date cannot be before the start date.');
    const nextError = revisedDateError(issue.due, issue.next);
    if (nextError) throw new Error(nextError);
    const existing = await localStore.loadTasks();
    const task = {
      id: issue.id || nextIssueId(existing, issue.manager, readList(DELETED_KEY)),
      createdAt: new Date().toISOString(),
      manager: issue.manager, program: issue.program, desc: issue.desc, dept: normalizeDepartment(issue.dept),
      customer: issue.customer || '', owner: issue.owner, member: issue.member || '',
      initialManager: issue.initialManager || issue.manager,
      start: issue.start || null, due: issue.due || null, next: issue.next || null, closed: issue.closed || null,
      sourceStatus: issue.sourceStatus || '',
      dueAcceptance: issue.due ? 'pending' : null, dueProposedAt: issue.due ? new Date().toISOString() : null,
      redFlag: false,
      remark: issue.remark || '', proofs: [],
    };
    write(ADDED_KEY, [...readList(ADDED_KEY), task]);
    logEvent(task.id, session, 'created', { manager: task.manager, program: task.program, owner: task.owner, dept: task.dept, due_date: task.due });
    return task;
  },

  async patchTask(id, patch, session) {
    const before = requireTask(id, session);
    const has = (key) => Object.prototype.hasOwnProperty.call(patch, key);
    if (has('manager') && patch.manager !== before.manager && session.role !== 'Admin') {
      throw new Error('Only an admin can move an issue to another tracker.');
    }
    if (has('due') && patch.due !== before.due && session.role === 'Owner') {
      throw new Error('Owners accept or reject the target date; they cannot change it.');
    }
    if (has('closed') && patch.closed && !before.closed && !(before.proofs || []).length) {
      throw new Error('Attach proof before closing this issue.');
    }
    const normalizedPatch = { ...patch };
    const wasClosed = before.closed || String(before.sourceStatus || '').toLowerCase() === 'closed';
    const detailsChanged = Object.keys(normalizedPatch).some((key) => key !== 'closed' && key !== 'updatedAt' && !(key === 'sourceStatus' && wasClosed && normalizedPatch.closed === null));
    // Same closed-issue rules as the database (migration 0030): the assigned owner may edit details
    // but never reopen; managers may add a remark (or reopen) but must reopen before other edits.
    const touchesLifecycle = Object.prototype.hasOwnProperty.call(patch, 'closed') || Object.prototype.hasOwnProperty.call(patch, 'sourceStatus');
    if (wasClosed && session?.role === 'Owner' && touchesLifecycle) {
      throw new Error('Only your manager can reopen a closed issue or change its close date.');
    }
    if (wasClosed && detailsChanged) {
      const ownerEdit = session?.role === 'Owner' && isOwnerOf(session, before) && !touchesLifecycle;
      const managerRemark = ['Manager', 'Dept Head', 'Admin'].includes(session?.role)
        && Object.keys(patch).every((key) => key === 'remark' || key === 'srNo');
      if (!ownerEdit && !managerRemark) throw new Error('This issue is closed. Reopen it before editing details.');
    }
    if (!before.closed && normalizedPatch.closed && detailsChanged) {
      throw new Error('Save issue details before using the explicit Close action.');
    }
    if (!wasClosed && String(normalizedPatch.sourceStatus || '').toLowerCase() === 'closed') {
      throw new Error('Use the explicit Close action to close an issue.');
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'dueAcceptance')) {
      if (session?.role !== 'Owner' || !isOwnerOf(session, before) || !['accepted', 'rejected'].includes(patch.dueAcceptance)) {
        throw new Error('Only the assigned owner can accept or reject a target date.');
      }
      if (before.dueAcceptance !== 'pending') throw new Error('This target date is no longer awaiting a response.');
      const proposedAt = Date.parse(before.dueProposedAt || '');
      if (!Number.isFinite(proposedAt) || Date.now() - proposedAt >= 3 * 86400000) {
        normalizedPatch.dueAcceptance = 'auto_accepted';
        normalizedPatch.dueAcceptedAt = new Date().toISOString();
      } else if (patch.dueAcceptance === 'accepted') {
        normalizedPatch.dueAcceptedAt = new Date().toISOString();
      }
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'due') && patch.due !== before.due) {
      normalizedPatch.dueAcceptance = patch.due ? 'pending' : null;
      normalizedPatch.dueProposedAt = patch.due ? new Date().toISOString() : null;
      normalizedPatch.dueAcceptedAt = null;
    }
    const nextDue = Object.prototype.hasOwnProperty.call(normalizedPatch, 'due') ? normalizedPatch.due : before.due;
    if (!nextDue) throw new Error('Target date is required.');
    const nextStart = has('start') ? patch.start : before.start;
    if (nextStart && nextDue < nextStart) throw new Error('Target date cannot be before the start date.');
    if (has('next') || has('due')) {
      const nextError = revisedDateError(nextDue, has('next') ? patch.next : before.next);
      if (nextError) throw new Error(nextError);
    }
    const requiredFields = [
      ['manager', 'Manager'], ['program', 'Program'], ['desc', 'Issue description'],
      ['dept', 'Department'], ['owner', 'Owner'], ['start', 'Start date'],
    ];
    for (const [key, label] of requiredFields) {
      if (!Object.prototype.hasOwnProperty.call(normalizedPatch, key)) continue;
      const value = normalizedPatch[key];
      if (value == null || String(value).trim() === '') throw new Error(`${label} is required.`);
    }
    const changes = {};
    Object.keys(normalizedPatch).forEach((k) => {
      const from = before[k] ?? null;
      const to = normalizedPatch[k] === '' ? null : normalizedPatch[k] ?? null;
      if (from !== to) changes[EVENT_COLS[k] || k] = { from, to };
    });
    const edits = read(EDITS_KEY);
    edits[id] = { ...(edits[id] || {}), ...normalizedPatch };
    write(EDITS_KEY, edits);
    if (Object.keys(changes).length) logEvent(id, session, 'update', changes);
  },

  async deleteTasks(ids, session) {
    const selected = new Set(ids);
    const tasks = [...selected].map(findTask).filter(Boolean);
    if (tasks.length !== selected.size) throw new Error('One or more issues were not found in this browser.');
    const allowed = (task) => session?.role === 'Admin' || (session?.role === 'Manager' && !session.pending && task.manager === session.name);
    if (!tasks.every(allowed)) throw new Error('Only an admin, or the manager of the tracker, can delete these issues.');
    for (const task of tasks) {
      for (const proof of task.proofs || []) await fileOp('readwrite', (s) => s.delete(proof.id));
    }
    const proofs = read(PROOFS_KEY);
    const edits = read(EDITS_KEY);
    tasks.forEach((task) => { delete proofs[task.id]; delete edits[task.id]; });
    write(PROOFS_KEY, proofs);
    write(EDITS_KEY, edits);
    write(ADDED_KEY, readList(ADDED_KEY).filter((item) => !selected.has(item.id)));
    write(DELETED_KEY, [...new Set([...readList(DELETED_KEY), ...selected])]);
    write(EVENTS_KEY, readList(EVENTS_KEY).filter((event) => !selected.has(event.task_id)));
    return [...selected];
  },

  async deleteTask(id, session) {
    await localStore.deleteTasks([id], session);
  },

  async addProof(taskId, file, session) {
    requireTask(taskId, session);
    const fileError = validateFile(file);
    if (fileError) throw new Error(fileError);
    const id = createUuid();
    await fileOp('readwrite', (s) => s.put(file, id));
    const meta = {
      id, name: file.name, mime: file.type || mimeFor(file.name), size: file.size, path: id,
      at: new Date().toISOString(), by: (session && (session.display || session.name)) || 'You', byId: (session && session.id) || null,
    };
    const all = read(PROOFS_KEY);
    all[taskId] = [...(all[taskId] || []), meta];
    write(PROOFS_KEY, all);
    logEvent(taskId, session, 'proof_added', { filename: file.name, size: file.size });
    return meta;
  },

  async removeProof(taskId, proof, session) {
    const task = requireTask(taskId, session);
    if (!canRemoveProof(session, task, proof)) throw new Error('You can only remove proof you uploaded, while the issue is open.');
    await fileOp('readwrite', (s) => s.delete(proof.id));
    const all = read(PROOFS_KEY);
    all[taskId] = (all[taskId] || []).filter((p) => p.id !== proof.id);
    write(PROOFS_KEY, all);
    logEvent(taskId, session, 'proof_removed', { filename: proof.name });
  },

  async getProofUrl(proof) {
    const blob = await fileOp('readonly', (s) => s.get(proof.id));
    if (!blob) throw new Error('This file is not stored on this device.');
    return URL.createObjectURL(blob);
  },
};
