// End-to-end tests of the demo store (lib/store/local.js), which holds the app's business rules when
// Supabase is not configured. Each test starts from a clean browser (empty localStorage + IndexedDB).
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The store is written for the bundler: extensionless imports and a plain JSON import.
registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); } catch (error) {
      if (specifier.startsWith('.') && !/\.\w+$/.test(specifier)) return next(`${specifier}.js`, context);
      throw error;
    }
  },
  load(url, context, next) {
    if (url.endsWith('.json')) {
      return { format: 'module', source: `export default ${readFileSync(fileURLToPath(url), 'utf8')};`, shortCircuit: true };
    }
    return next(url, context);
  },
});

// ── browser stand-ins ──
const storage = new Map();
globalThis.localStorage = {
  getItem: (k) => (storage.has(k) ? storage.get(k) : null),
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k),
  clear: () => storage.clear(),
};
const files = new Map();
globalThis.indexedDB = {
  open() {
    const req = {};
    const db = {
      createObjectStore() {},
      transaction() {
        const tx = {};
        const done = (result) => { const r = { result }; setTimeout(() => tx.oncomplete?.()); return r; };
        tx.objectStore = () => ({
          put: (value, key) => done(files.set(key, value) && key),
          get: (key) => done(files.get(key)),
          delete: (key) => done(files.delete(key) && undefined),
          clear: () => done(files.clear()),
        });
        return tx;
      },
      close() {},
    };
    setTimeout(() => { req.result = db; req.onupgradeneeded?.(); req.onsuccess?.(); });
    return req;
  },
};
globalThis.URL.createObjectURL = () => 'blob:test';

const { localStore: store } = await import('./local.js');
const { deriveTask, startOfToday, fmtDate } = await import('../rules.js');

const manager = { name: 'Sagar Ingle', display: 'Sagar Ingle', role: 'Manager', dept: 'PRGM' };
const otherManager = { name: 'Akhil Deshmukh', display: 'Akhil Deshmukh', role: 'Manager', dept: 'PRCE' };
const admin = { name: 'Naveen Sahni', display: 'Naveen Sahni', role: 'Admin', dept: 'All' };
const owner = { name: 'Vishal Pawar', display: 'Vishal Pawar', role: 'Owner', dept: 'PRGM' };
const stranger = { name: 'Nobody Here', display: 'Nobody Here', role: 'Owner', dept: 'PRGM' };
const deptHead = { name: 'Process Dept Head', display: 'Process Dept Head', role: 'Dept Head', dept: 'PROCESS' };

const day = (offset) => { const d = startOfToday(); d.setDate(d.getDate() + offset); return fmtDate(d); };
const pdf = (name = 'proof.pdf') => ({ name, type: 'application/pdf', size: 1234 });
const fresh = () => { storage.clear(); files.clear(); };
const newIssue = (over = {}) => store.addTask({
  manager: 'Sagar Ingle', program: 'P1', desc: 'Fix the fixture', dept: 'PRGM', owner: 'Vishal Pawar',
  start: day(-5), due: day(10), ...over,
}, manager);
const get = async (id) => (await store.loadTasks()).find((t) => t.id === id);

test('loads the demo tracker data', async () => {
  fresh();
  const tasks = await store.loadTasks();
  assert.ok(tasks.length > 900);
  assert.ok(tasks.every((t) => t.id && t.manager && Array.isArray(t.proofs)));
  assert.equal(new Set(tasks.map((t) => t.id)).size, tasks.length, 'issue ids are unique');
  assert.deepEqual(await store.listManagers(), ['Sagar Ingle', 'Abhijit Mendki', 'Akhil Deshmukh', 'Yogesh Dhamale']);
});

test('only a Platform Manager adds issues, only in their own tracker, with valid fields', async () => {
  fresh();
  const task = await newIssue();
  assert.match(task.id, /^[A-Z]+-\d+$/);
  assert.equal(task.dueAcceptance, 'pending');
  for (const who of [owner, admin, deptHead]) {
    await assert.rejects(store.addTask({ manager: 'Sagar Ingle', program: 'P', desc: 'D', due: day(3) }, who), /Only a Platform Manager/);
  }
  await assert.rejects(store.addTask({ manager: 'Akhil Deshmukh', program: 'P', desc: 'D', due: day(3) }, manager), /own tracker/);
  await assert.rejects(newIssue({ due: null }), /Target date is required/);
  await assert.rejects(newIssue({ program: ' ' }), /Program is required/);
  await assert.rejects(newIssue({ desc: '' }), /description is required/);
  await assert.rejects(newIssue({ start: day(5), due: day(1) }), /before the start date/);
  await assert.rejects(newIssue({ due: day(1), next: day(20) }), /7 days/);
  const second = await newIssue();
  assert.notEqual(second.id, task.id, 'ids are never reused');
});

test('access: managers edit their tracker, owners their own issues, strangers nothing', async () => {
  fresh();
  const task = await newIssue();
  await store.patchTask(task.id, { remark: 'manager note' }, manager);
  await store.patchTask(task.id, { remark: 'owner note' }, owner);
  await store.patchTask(task.id, { remark: 'admin note' }, admin);
  await assert.rejects(store.patchTask(task.id, { remark: 'x' }, otherManager), /not allowed/);
  await assert.rejects(store.patchTask(task.id, { remark: 'x' }, stranger), /not allowed/);
  await assert.rejects(store.patchTask(task.id, { remark: 'x' }, undefined), /not allowed/);
  await assert.rejects(store.patchTask('NOPE-1', { remark: 'x' }, admin), /was not found/);
  assert.equal((await get(task.id)).remark, 'admin note');
});

test('field rules: target date, revised date, tracker and required fields', async () => {
  fresh();
  const task = await newIssue();
  await assert.rejects(store.patchTask(task.id, { due: day(20) }, owner), /cannot change it/);
  await assert.rejects(store.patchTask(task.id, { manager: 'Akhil Deshmukh' }, manager), /Only an admin/);
  await assert.rejects(store.patchTask(task.id, { due: null }, manager), /Target date is required/);
  await assert.rejects(store.patchTask(task.id, { program: '' }, manager), /Program is required/);
  await assert.rejects(store.patchTask(task.id, { next: day(30) }, manager), /7 days/);
  await assert.rejects(store.patchTask(task.id, { due: day(-10) }, manager), /before the start date/);
  await store.patchTask(task.id, { next: day(14) }, manager);
  await store.patchTask(task.id, { due: day(12) }, manager);
  assert.equal((await get(task.id)).dueAcceptance, 'pending', 'a new target date asks the owner again');
});

test('owner accepts or rejects the target date; nobody else can', async () => {
  fresh();
  const task = await newIssue();
  await assert.rejects(store.patchTask(task.id, { dueAcceptance: 'accepted' }, manager), /Only the assigned owner/);
  await store.patchTask(task.id, { dueAcceptance: 'accepted' }, owner);
  const saved = await get(task.id);
  assert.equal(saved.dueAcceptance, 'accepted');
  assert.ok(saved.dueAcceptedAt);
  await assert.rejects(store.patchTask(task.id, { dueAcceptance: 'rejected' }, owner), /no longer awaiting/);
});

test('auto-accept reports how many issues it changed', async () => {
  fresh();
  const task = await newIssue();
  assert.equal(await store.autoAcceptDueDates(), 0);
  const edits = JSON.parse(localStorage.getItem('brembo.edits.v2') || '{}');
  edits[task.id] = { ...(edits[task.id] || {}), dueProposedAt: new Date(Date.now() - 4 * 86400000).toISOString() };
  localStorage.setItem('brembo.edits.v2', JSON.stringify(edits));
  assert.equal(await store.autoAcceptDueDates(), 1);
  assert.equal((await get(task.id)).dueAcceptance, 'auto_accepted');
  assert.equal(await store.autoAcceptDueDates(), 0);
});

test('proof: upload rules, close needs proof, owner may close, removal rules', async () => {
  fresh();
  const task = await newIssue();
  await assert.rejects(store.patchTask(task.id, { closed: day(0) }, owner), /Attach proof/);
  await assert.rejects(store.addProof(task.id, { name: 'evil.html', type: 'text/html', size: 10 }, owner), /not allowed/);
  await assert.rejects(store.addProof(task.id, { name: 'empty.pdf', type: 'application/pdf', size: 0 }, owner), /empty/);
  await assert.rejects(store.addProof(task.id, { name: 'big.pdf', type: 'application/pdf', size: 11 * 1048576 }, owner), /larger/);
  await assert.rejects(store.addProof(task.id, pdf(), stranger), /not allowed/);
  const proof = await store.addProof(task.id, pdf(), owner);
  assert.equal(proof.by, 'Vishal Pawar');
  assert.equal(await store.getProofUrl(proof), 'blob:test');
  const managerProof = await store.addProof(task.id, pdf('mgr.pdf'), manager);
  await assert.rejects(store.removeProof(task.id, managerProof, owner), /only remove proof you uploaded/);
  await store.removeProof(task.id, managerProof, manager);
  await store.patchTask(task.id, { closed: day(0) }, owner);
  const closed = deriveTask(await get(task.id), startOfToday());
  assert.equal(closed.status, 'Closed');
  await assert.rejects(store.removeProof(task.id, proof, owner), /while the issue is open/);
});

test('closed issue: owner edits details but cannot reopen; manager adds remark or reopens', async () => {
  fresh();
  const task = await newIssue();
  await store.addProof(task.id, pdf(), owner);
  await store.patchTask(task.id, { closed: day(0) }, owner);
  await store.patchTask(task.id, { desc: 'Owner corrected text', remark: 'see v2' }, owner);
  await store.addProof(task.id, pdf('v2.pdf'), owner);
  await assert.rejects(store.patchTask(task.id, { closed: null, sourceStatus: 'Open' }, owner), /Only your manager/);
  await store.patchTask(task.id, { remark: 'Proof not signed' }, manager);
  await assert.rejects(store.patchTask(task.id, { desc: 'manager edit' }, manager), /Reopen it/);
  await store.patchTask(task.id, { closed: null, sourceStatus: 'Open' }, manager);
  const reopened = deriveTask(await get(task.id), startOfToday());
  assert.notEqual(reopened.status, 'Closed');
  assert.equal(reopened.desc, 'Owner corrected text');
  assert.equal((await get(task.id)).proofs.length, 2);
});

test('remarks between manager and owner are comments that mention the other side', async () => {
  fresh();
  const { buildRemark, remarkThread } = await import('../remarks.js');
  const { buildNotifications } = await import('../events.js');
  const task = await newIssue();
  const toOwner = buildRemark(task, manager, 'Proof is blurred', { reopened: true });
  await store.addComment(task.id, toOwner.text, toOwner.mentions, manager);
  const toManager = buildRemark(task, owner, 'Uploaded a clear copy');
  await store.addComment(task.id, toManager.text, toManager.mentions, owner);
  const thread = remarkThread(await store.listTaskHistory(task.id));
  assert.deepEqual(thread.map((m) => m.by), ['Sagar Ingle', 'Vishal Pawar']);
  const events = await store.listEvents();
  const derived = (await store.loadTasks()).map((t) => deriveTask(t, startOfToday()));
  assert.ok(buildNotifications(events, derived, owner).some((n) => n.kind === 'mention' && /Proof is blurred/.test(n.text)));
  assert.ok(buildNotifications(events, derived, manager).some((n) => n.kind === 'mention' && /clear copy/.test(n.text)));
  await assert.rejects(store.addComment(task.id, '   ', [], owner), /Write a comment/);
  await assert.rejects(store.addComment(task.id, 'x'.repeat(2001), [], owner), /2000/);
});

test('only the author edits a comment', async () => {
  fresh();
  const task = await newIssue();
  await store.addComment(task.id, 'first', [], manager);
  const comment = (await store.listTaskHistory(task.id)).find((e) => e.action === 'comment');
  await assert.rejects(store.updateComment(comment.detail.comment_id, 'hijack', [], owner), /your own comment/);
  await store.updateComment(comment.detail.comment_id, 'edited', [], manager);
  const after = (await store.listTaskHistory(task.id)).find((e) => e.action === 'comment');
  assert.equal(after.detail.text, 'edited');
  assert.ok((await store.listTaskHistory(task.id)).some((e) => e.action === 'comment_edited'));
});

test('history records every change in database column names', async () => {
  fresh();
  const task = await newIssue();
  await store.patchTask(task.id, { owner: 'Vishal Pawar / Gaurav Patky', next: day(12) }, manager);
  const update = (await store.listTaskHistory(task.id)).find((e) => e.action === 'update');
  assert.deepEqual(Object.keys(update.detail).sort(), ['next_date', 'owner']);
  assert.ok((await store.listTaskHistory(task.id)).some((e) => e.action === 'created'));
});

test('delete: admin any issue, manager own tracker, owner never; numbers are not reused', async () => {
  fresh();
  const a = await newIssue();
  await assert.rejects(store.deleteTasks([a.id], owner), /Only an admin/);
  await assert.rejects(store.deleteTasks([a.id], otherManager), /Only an admin/);
  await assert.rejects(store.deleteTasks(['NOPE-9'], admin), /not found/);
  await store.addProof(a.id, pdf(), owner);
  await store.deleteTasks([a.id], manager);
  assert.equal(await get(a.id), undefined);
  assert.equal(files.size, 0, 'proof files are removed with the issue');
  const b = await newIssue();
  assert.notEqual(b.id, a.id);
  await store.deleteTask(b.id, admin);
  assert.equal(await get(b.id), undefined);
});

test('red flags are counted', async () => {
  fresh();
  const before = await store.getRedFlagCount();
  const task = await newIssue();
  await store.patchTask(task.id, { redFlag: true }, manager);
  assert.equal(await store.getRedFlagCount(), before + 1);
});

test('people list: roles, duplicates, renames', async () => {
  fresh();
  const people = await store.listEmployees();
  assert.ok(people.length > 10);
  await assert.rejects(store.saveEmployee({ name: 'New Person' }, owner), /Only admins/);
  const saved = await store.saveEmployee({ name: '  New   Person ', email: 'NEW@bremboindia.com' }, manager);
  assert.equal(saved.name, 'New Person');
  assert.equal(saved.email, 'new@bremboindia.com');
  await assert.rejects(store.saveEmployee({ name: 'new person' }, manager), /already on the list/);
  await assert.rejects(store.saveEmployee({ id: saved.id, name: 'Renamed' }, manager), /Only a dept head/);
  await store.saveEmployee({ id: saved.id, name: 'Renamed Person' }, deptHead);
  await assert.rejects(store.deleteEmployee(saved.id, manager), /Only an admin/);
  await store.deleteEmployee(saved.id, admin);
  assert.ok(!(await store.listEmployees()).some((e) => e.id === saved.id));
});

test('rename owner across issues (dept head / owner-name editors only)', async () => {
  fresh();
  const task = await newIssue({ owner: 'Temp Owner' });
  await assert.rejects(store.renameOwner('Temp Owner', 'Real Owner', manager), /Only a dept head/);
  const n = await store.renameOwner('Temp Owner', 'Real Owner', { ...admin, canEditOwnerNames: true });
  assert.ok(n >= 1);
  assert.equal((await get(task.id)).owner, 'Real Owner');
});

test('departments and saved views', async () => {
  fresh();
  await assert.rejects(store.saveDepartment({ code: 'NEW' }, owner), /Only admins/);
  await assert.rejects(store.saveDepartment({ code: ' ' }, manager), /Enter a department code/);
  await store.saveDepartment({ code: 'NEW', name: 'New dept' }, manager);
  assert.deepEqual((await store.listDepartments()).map((d) => d.code), ['NEW']);
  const view = await store.saveView('Mine', { owner: 'X' }, manager);
  await assert.rejects(store.saveView(' mine ', {}, manager), /already have a view/);
  assert.equal((await store.listViews(manager)).length, 1);
  assert.equal((await store.listViews(owner)).length, 0, 'views are per person');
  await store.deleteView(view.id, manager);
  assert.equal((await store.listViews(manager)).length, 0);
});

test('demo auth: no password sign-in, sign-up validates', async () => {
  await assert.rejects(store.signIn('a', 'b'), /quick-login/);
  await assert.rejects(store.signUp({ name: '', email: 'x', password: 'y' }), /required/);
  assert.equal(await store.getSession(), null);
});
