// Target-date acceptance (3 days) and revised-date window (7 days).
const DAY = 86400000;

function parseStamp(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysBetween(from, to) {
  const a = parseStamp(from);
  const b = parseStamp(to);
  if (!a || !b) return null;
  const startA = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const startB = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((startB - startA) / DAY);
}

function dueAcceptanceOf(task, today = new Date()) {
  if (!task?.due) return { status: null, auto: false, remainingDays: null };
  const current = task.dueAcceptance || 'accepted';
  if (current === 'accepted' || current === 'auto_accepted' || current === 'rejected') {
    return { status: current, auto: false, remainingDays: null };
  }
  const proposed = parseStamp(task.dueProposedAt);
  const currentTime = parseStamp(today) || new Date();
  const elapsedMs = proposed ? Math.max(0, currentTime.getTime() - proposed.getTime()) : 0;
  const remainingMs = Math.max(0, 3 * DAY - elapsedMs);
  if (proposed && elapsedMs >= 3 * DAY) {
    return { status: 'auto_accepted', auto: true, remainingDays: 0 };
  }
  return { status: 'pending', auto: false, remainingDays: proposed ? Math.ceil(remainingMs / DAY) : 3 };
}

function maxRevisedDate(due) {
  if (!due) return null;
  const [y, m, d] = String(due).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  const next = new Date(y, m - 1, d + 7);
  const p = (n) => String(n).padStart(2, '0');
  return `${next.getFullYear()}-${p(next.getMonth() + 1)}-${p(next.getDate())}`;
}

function revisedDateError(due, next) {
  if (!next || !due) return null;
  if (next > maxRevisedDate(due)) return 'The revised date cannot be more than 7 days after the target date.';
  return null;
}

function sortMostOverdueFirst(tasks) {
  return [...tasks].sort((a, b) => {
    const aClosed = a.status === 'Closed' ? 1 : 0;
    const bClosed = b.status === 'Closed' ? 1 : 0;
    if (aClosed !== bClosed) return aClosed - bClosed;
    const aLate = Number(a.daysLate || 0);
    const bLate = Number(b.daysLate || 0);
    if (aLate !== bLate) return bLate - aLate;
    const aDue = a.daysToDue == null ? 9999 : a.daysToDue;
    const bDue = b.daysToDue == null ? 9999 : b.daysToDue;
    if (aDue !== bDue) return aDue - bDue;
    return String(a.id || '').localeCompare(String(b.id || ''), undefined, { numeric: true });
  });
}

module.exports = { dueAcceptanceOf, maxRevisedDate, revisedDateError, sortMostOverdueFirst, daysBetween };
