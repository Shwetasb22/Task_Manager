// Quick views for the Task Register ("My overdue", "Due this week", ...) and saved views.
// A view is { q, status, quick }: the search text, the status filter and one quick view id.
const { getTaskStatusPresentation, parseDate, LEGACY_STATUS_LABELS } = require('./rules.js');
const { isOwnerOf } = require('./owners.js');

const DAY = 86400000;

const QUICK_VIEWS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'mine', label: 'My open issues', test: (t, ctx) => t.status !== 'Closed' && isMine(t, ctx.session) },
  { id: 'overdue', label: 'Overdue', test: (t) => t.status === 'Overdue' },
  { id: 'week', label: 'Due in 7 days', test: (t) => t.status !== 'Closed' && t.daysToDue !== null && t.daysToDue !== undefined && t.daysToDue >= 0 && t.daysToDue <= 7 },
  { id: 'l3', label: 'Escalated (L3)', test: (t) => t.esc === 'L3 HOD' },
  { id: 'gap', label: 'No target date', test: (t) => t.status !== 'Closed' && t.rgy === 'Grey' },
  { id: 'closed30', label: 'Closed in 30 days', test: (t, ctx) => Boolean(t.closed) && ctx.today - parseDate(t.closed) <= 30 * DAY },
  { id: 'new7', label: 'Added in 7 days', test: (t, ctx) => Boolean(t.createdAt) && ctx.today - new Date(t.createdAt) <= 7 * DAY },
];

// "Mine": an owner's own issues; for a manager or admin, issues where they are named as owner.
function isMine(task, session) {
  if (!session) return false;
  if (session.role === 'Owner') return isOwnerOf(session, task);
  return isOwnerOf({ ...session, role: 'Owner', aliases: [] }, task);
}

function matchesStatus(task, status) {
  if (!status || status === 'All') return true;
  if (status === 'Active') return task.status !== 'Closed';
  // Colour statuses (RYGB): Due Soon, On Track, No Target Date ('Data Gap' in older saved views).
  const colour = LEGACY_STATUS_LABELS[status] || status;
  if (['Due Soon', 'On Track', 'No Target Date'].includes(colour)) return getTaskStatusPresentation(task).label === colour;
  return task.status === status;
}

function matchesSearch(task, q) {
  const s = String(q || '').trim().toLowerCase();
  if (!s) return true;
  return [
    task.id, task.manager, task.customer, task.program, task.desc, task.dept, task.owner, task.start, task.due, task.next,
    task.status, task.rgy, task.sev, task.risk, task.esc, task.closed, task.remark, task.alert,
    ...(task.proofs || []).map((proof) => proof.name),
  ].some((value) => String(value ?? '').toLowerCase().includes(s));
}

// tasks must already be derived (lib/rules.js deriveTask). ctx = { today, session }.
function filterTasks(tasks, view, ctx) {
  const quick = QUICK_VIEWS.find((v) => v.id === (view.quick || 'all')) || QUICK_VIEWS[0];
  return tasks.filter((t) => quick.test(t, ctx) && matchesStatus(t, view.status) && matchesSearch(t, view.q));
}

function countQuickViews(tasks, ctx) {
  const counts = {};
  QUICK_VIEWS.forEach((v) => { counts[v.id] = 0; });
  tasks.forEach((t) => QUICK_VIEWS.forEach((v) => { if (v.test(t, ctx)) counts[v.id] += 1; }));
  return counts;
}

// A saved view stores only known keys, so an old or edited row cannot break the register.
function cleanView(filters) {
  const f = filters && typeof filters === 'object' ? filters : {};
  return {
    q: typeof f.q === 'string' ? f.q.slice(0, 200) : '',
    status: ['Active', 'All', 'Overdue', 'Open', 'Due Soon', 'On Track', 'No Target Date', 'Closed'].includes(LEGACY_STATUS_LABELS[f.status] || f.status) ? (LEGACY_STATUS_LABELS[f.status] || f.status) : 'Active',
    quick: QUICK_VIEWS.some((v) => v.id === f.quick) ? f.quick : 'all',
  };
}

function describeView(view) {
  const v = cleanView(view);
  const parts = [];
  if (v.quick !== 'all') parts.push(QUICK_VIEWS.find((x) => x.id === v.quick).label);
  if (v.status && v.status !== 'All' && v.status !== 'Active') parts.push(v.status);
  if (v.q) parts.push(`"${v.q}"`);
  return parts.join(' · ') || (v.status === 'All' ? 'All issues' : 'Active issues');
}

module.exports = { QUICK_VIEWS, filterTasks, countQuickViews, cleanView, describeView, matchesSearch, matchesStatus };
