// Dashboard data: RYGB groupings (see lib/rules.js) and Power BI-style cross-filtering.
//
// Cross-filtering: a click on any visual adds a selection on one *dimension* (status colour,
// department, owner, escalation level, lateness window). Every visual then shows the issues that
// match all selections EXCEPT its own dimension, so the clicked visual keeps all its bars (the
// chosen ones highlighted) while every other visual narrows down — the way Power BI behaves.
import { RYGB, RYGB_ORDER, rygbOf, ESCALATION_STAGES } from '../rules.js';

/**
 * @typedef {object} DashboardTask
 * @property {string} [id]
 * @property {string|null} [dept]
 * @property {string|null} [rgy]
 * @property {string|null} [status]
 * @property {number|null} [daysLate]
 * @property {number|null} [daysToDue]
 * @property {string} [program]
 * @property {string} [owner]
 * @property {string|null} [esc]
 */

const emptyCounts = () => ({ red: 0, yellow: 0, green: 0, blue: 0, grey: 0, total: 0 });

export function deptKey(task) {
  const department = String(task?.dept ?? '').trim();
  return department && department !== 'Unassigned' ? department.toLocaleUpperCase() : 'Unassigned';
}
export function ownerKey(task) {
  return String(task?.owner ?? '').trim() || 'Unassigned';
}
// Escalation applies to open work only. "Neutral" is split by colour: healthy work (green) versus
// work with no target date (grey), so each bar keeps one meaning.
export const NO_DATE_LEVEL = 'No target date';
export function escKey(task) {
  if (!task || task.status === 'Closed') return null;
  const level = task.esc || 'Neutral';
  return level === 'Neutral' && rygbOf(task) === 'Grey' ? NO_DATE_LEVEL : level;
}

// Lateness windows of open work, each coloured by the RYGB rule (two shades where a colour splits).
export const LATENESS_BUCKETS = Object.freeze([
  { key: 'overdue-critical', label: '8+ days overdue', action: 'L3 HOD · recovery plan', tone: 'Red', color: '#8E0B20' },
  { key: 'overdue', label: '1-7 days overdue', action: 'L1 Owner · recover now', tone: 'Red', color: RYGB.Red.color },
  { key: 'due-soon', label: 'Due in 0-3 days', action: 'L2 Manager · confirm readiness', tone: 'Yellow', color: RYGB.Yellow.color },
  { key: 'due-next', label: 'Due in 4-7 days', action: 'Plan and monitor', tone: 'Green', color: RYGB.Green.color },
  { key: 'future', label: 'Due in 8+ days', action: 'Routine follow-up', tone: 'Green', color: '#1E7A44' },
  { key: 'gap', label: 'Missing target date', action: 'Set a valid target date', tone: 'Grey', color: RYGB.Grey.color },
]);

export function latenessKey(task) {
  if (!task || String(task.status || '').toLowerCase() === 'closed') return null;
  if (task.daysToDue === null || task.daysToDue === undefined) return 'gap';
  const daysLate = Number(task.daysLate ?? (Number(task.daysToDue) < 0 ? -Number(task.daysToDue) : 0));
  if (daysLate > 7) return 'overdue-critical';
  if (daysLate > 0) return 'overdue';
  if (task.daysToDue <= 3) return 'due-soon';
  if (task.daysToDue <= 7) return 'due-next';
  return 'future';
}

// Escalation colours follow the RYGB meaning of each level.
export const ESCALATION_COLORS = Object.freeze({
  Neutral: RYGB.Green.color, // no escalation: more than 3 days to target
  [NO_DATE_LEVEL]: RYGB.Grey.color, // cannot escalate until a target date is set
  'L1 Owner': RYGB.Red.color, // up to 7 days overdue
  'L2 Manager': RYGB.Yellow.color, // due within 3 days
  'L3 HOD': '#8E0B20', // more than 7 days overdue
});

export const DIMENSIONS = Object.freeze({
  rygb: { label: 'Status', key: rygbOf, name: (v) => RYGB[v]?.label || v },
  dept: { label: 'Department', key: deptKey, name: (v) => v },
  owner: { label: 'Owner', key: ownerKey, name: (v) => v },
  esc: { label: 'Escalation', key: escKey, name: (v) => (v === 'Neutral' ? 'No escalation' : v) },
  lateness: { label: 'Lateness', key: latenessKey, name: (v) => LATENESS_BUCKETS.find((b) => b.key === v)?.label || v },
});

/**
 * Tasks matching every selection except the `except` dimension.
 * @param {DashboardTask[]} tasks
 * @param {Record<string, string[]>} selection e.g. { rygb: ['Red'], dept: ['PE', 'QE'] }
 * @param {string} [except]
 */
export function crossFilter(tasks, selection, except) {
  const active = Object.entries(selection || {})
    .filter(([dim, values]) => dim !== except && DIMENSIONS[dim] && values && values.length)
    .map(([dim, values]) => [DIMENSIONS[dim].key, new Set(values)]);
  if (!active.length) return tasks;
  return tasks.filter((task) => active.every(([key, values]) => values.has(key(task))));
}

/**
 * New selection after a click. Plain click: select only these values (clicking the same thing again
 * clears it). Ctrl/Cmd/Shift click (`additive`): add or remove these values, keeping the rest.
 */
export function toggleSelection(selection, dim, values, additive = false) {
  const next = { ...(selection || {}) };
  const current = new Set(next[dim] || []);
  const clicked = [...new Set(values)];
  if (additive) {
    const allIn = clicked.every((v) => current.has(v));
    clicked.forEach((v) => (allIn ? current.delete(v) : current.add(v)));
  } else {
    const same = current.size === clicked.length && clicked.every((v) => current.has(v));
    current.clear();
    if (!same) clicked.forEach((v) => current.add(v));
  }
  if (current.size) next[dim] = [...current];
  else delete next[dim];
  return next;
}

export const isSelected = (selection, dim, value) => Boolean(selection?.[dim]?.includes(value));
export const hasSelection = (selection, dim) => Boolean(selection?.[dim]?.length);

function addTo(counts, task) {
  counts[rygbOf(task).toLowerCase()] += 1;
  counts.total += 1;
}

// Rows of { [field]: name, red, yellow, green, blue, grey, total, members }, worst first.
// Beyond `limit` rows the rest are combined into "Others" (members lists what it contains).
function groupBy(tasks, keyOf, field, limit) {
  const groups = new Map();
  for (const task of tasks) {
    const name = keyOf(task);
    const row = groups.get(name) || { [field]: name, ...emptyCounts(), members: [name] };
    addTo(row, task);
    groups.set(name, row);
  }
  const sorted = [...groups.values()].sort((a, b) =>
    b.red - a.red || b.yellow - a.yellow || b.total - a.total || String(a[field]).localeCompare(String(b[field])));
  if (sorted.length <= limit) return sorted;
  const others = sorted.slice(limit).reduce((row, g) => {
    ['red', 'yellow', 'green', 'blue', 'grey', 'total'].forEach((k) => { row[k] += g[k]; });
    row.members.push(...g.members);
    return row;
  }, { [field]: 'Others', ...emptyCounts(), members: [] });
  return [...sorted.slice(0, limit), others];
}

/** RYGB counts per department (stacked bar). */
export function groupByDepartment(tasks, limit = 10) {
  return groupBy(tasks, deptKey, 'department', limit);
}

/** RYGB counts per owner (stacked bar), people with the most overdue work first. */
export function groupByOwner(tasks, limit = 10) {
  return groupBy(tasks, ownerKey, 'owner', limit);
}

/** One slice per RYGB colour, in theme order. */
export function groupByRgy(tasks) {
  const counts = Object.fromEntries(RYGB_ORDER.map((k) => [k, 0]));
  for (const task of tasks) counts[rygbOf(task)] += 1;
  return RYGB_ORDER.map((name) => ({ name, label: RYGB[name].label, value: counts[name], color: RYGB[name].color }));
}

/** Open work per lateness window. */
export function groupByDueDateAction(tasks) {
  const rows = LATENESS_BUCKETS.map((b) => ({ ...b, value: 0 }));
  const index = new Map(rows.map((r) => [r.key, r]));
  for (const task of tasks) {
    const key = latenessKey(task);
    if (key) index.get(key).value += 1;
  }
  return rows;
}

// Bars of the escalation chart, most severe first.
const ESCALATION_ROWS = [
  ...['L3 HOD', 'L1 Owner', 'L2 Manager'].map((level) => ESCALATION_STAGES.find((s) => s.level === level)),
  { level: 'Neutral', role: 'nobody yet', rule: 'More than 3 days to the target date' },
  { level: NO_DATE_LEVEL, role: 'the manager to set a date', rule: 'No target date, so it cannot be escalated' },
];

/** Open work per escalation level. */
export function groupByEscalation(tasks) {
  const counts = new Map(ESCALATION_ROWS.map((s) => [s.level, 0]));
  for (const task of tasks) {
    const key = escKey(task);
    if (key && counts.has(key)) counts.set(key, counts.get(key) + 1);
  }
  return ESCALATION_ROWS.map((stage) => ({
    level: stage.level, role: stage.role, rule: stage.rule, issues: counts.get(stage.level), color: ESCALATION_COLORS[stage.level],
  }));
}

/** Ten open issues with the most days overdue. */
export function getTopOverdueIssues(tasks) {
  const late = (task) => Number(task.daysLate ?? (Number(task.daysToDue) < 0 ? -Number(task.daysToDue) : 0));
  return tasks
    .filter((task) => String(task.status || '').toLowerCase() !== 'closed' && late(task) > 0)
    .sort((a, b) => late(b) - late(a) || String(a.id || '').localeCompare(String(b.id || '')))
    .slice(0, 10);
}
