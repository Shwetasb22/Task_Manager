// Business rules (originally ported from the tracker spreadsheet formulas)
// (Status, RGY, Alert, Severity, Next Action, Escalation Level, Risk Score,
// Days to Due, Management Flag). Raw inputs per task are:
//   due (Target Date), closed (Actual Close Date), next (Next Date), start, remark
// Everything else is DERIVED here against "today".
const DAY = 86400000;

// Parse 'YYYY-MM-DD' as a LOCAL date (new Date('2026-09-10') would be UTC and
// drift by hours in IST, breaking day counts).
function parseDate(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtShort(s) {
  const d = parseDate(s);
  if (!d) return '—';
  return `${String(d.getDate()).padStart(2, '0')}-${MON[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
}
function startOfToday() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

const ESCALATION_STAGES = [
  { level: 'Neutral', role: 'Track', rule: 'No due date or more than 3 days to due', rating: 0 },
  { level: 'L1 Owner', role: 'Owner', rule: 'Up to 7 days past due', rating: 1 },
  { level: 'L2 Manager', role: 'Manager', rule: 'Due within 3 days', rating: 2 },
  { level: 'L3 HOD', role: 'HOD', rule: 'More than 7 days past due, or no target date', rating: 3 },
];

// ── RYGB colour theme: the ONE rule every screen, chart, pill and row colour follows ──
//   Red    Overdue         – past the target date
//   Yellow Due Soon        – due within DUE_SOON_DAYS days (today included)
//   Green  On Track        – more than DUE_SOON_DAYS days to the target date (healthy)
//   Blue   Closed          – completed
//   Grey   No Target Date  – target date not defined
const DUE_SOON_DAYS = 3;
const RYGB = Object.freeze({
  Red: Object.freeze({ key: 'Red', label: 'Overdue', rule: 'Past the target date', color: '#C8102E', soft: '#FDE7EA', ink: '#9B1224' }),
  Yellow: Object.freeze({ key: 'Yellow', label: 'Due Soon', rule: `Due within ${DUE_SOON_DAYS} days`, color: '#E0A800', soft: '#FFF4D6', ink: '#7A5A00' }),
  Green: Object.freeze({ key: 'Green', label: 'On Track', rule: `More than ${DUE_SOON_DAYS} days to target`, color: '#2E9E5B', soft: '#E3F6EA', ink: '#146B38' }),
  Blue: Object.freeze({ key: 'Blue', label: 'Closed', rule: 'Completed', color: '#5B9BD5', soft: '#EAF3FC', ink: '#1F5F99' }),
  Grey: Object.freeze({ key: 'Grey', label: 'No Target Date', rule: 'Target date not defined', color: '#8B8588', soft: '#ECECEE', ink: '#4D4D55' }),
});
const RYGB_ORDER = Object.freeze(['Red', 'Yellow', 'Green', 'Blue', 'Grey']);
// Older saved views and links used these names.
const LEGACY_STATUS_LABELS = Object.freeze({ 'Data Gap': 'No Target Date', Gap: 'No Target Date' });

// RYGB key of a task, from its derived fields (works for raw-ish objects too).
function rygbOf(task) {
  if (!task) return 'Grey';
  if (RYGB[task.rgy]) return task.rgy;
  if (task.status === 'Closed') return 'Blue';
  if (task.daysToDue === null || task.daysToDue === undefined || !Number.isFinite(Number(task.daysToDue))) return 'Grey';
  if (Number(task.daysToDue) < 0) return 'Red';
  return Number(task.daysToDue) <= DUE_SOON_DAYS ? 'Yellow' : 'Green';
}

function escalationRating(level) {
  return (ESCALATION_STAGES.find((stage) => stage.level === level) || { rating: 0 }).rating;
}

function deriveTask(t, today) {
  const due = parseDate(t.due);
  const closed = parseDate(t.closed);
  const base = { ...t };

  if (closed || String(t.sourceStatus || '').trim().toLowerCase() === 'closed') {
    return { ...base, status: 'Closed', rgy: 'Blue', sev: 'Closed', esc: 'None', escRating: 0, risk: 0, alert: '',
      nextAction: 'Closed - evidence available', daysToDue: due ? Math.round((due - today) / DAY) : null,
      daysLate: null, flag: false };
  }
  if (!due) {
    return { ...base, status: 'Open', rgy: 'Grey', sev: 'Critical - Data Gap', esc: 'Neutral', escRating: 0, risk: 100,
      alert: 'Add target date', nextAction: 'Add missing target date', daysToDue: null, daysLate: null, flag: true };
  }
  const daysToDue = Math.round((due - today) / DAY);
  const late = -daysToDue;
  if (daysToDue < 0) {
    const sev = late > 7 ? 'Critical' : 'Medium';
    const esc = late > 7 ? 'L3 HOD' : 'L1 Owner';
    const nextAction = late > 7 ? 'Management intervention + recovery plan' : 'Close overdue action today';
    return { ...base, status: 'Overdue', rgy: 'Red', sev, esc, escRating: escalationRating(esc), risk: 50 + late * 5,
      alert: `RED: Delayed by ${late} day(s)`, nextAction, daysToDue, daysLate: late,
      flag: sev === 'Critical' || esc === 'L3 HOD' };
  }
  if (daysToDue <= DUE_SOON_DAYS) {
    return { ...base, status: 'Open', rgy: 'Yellow', sev: 'Watch', esc: 'L2 Manager', escRating: 2, risk: 30,
      alert: `YELLOW: Upcoming activity due in ${daysToDue} day(s)`, nextAction: 'Upcoming activity - pre-alert owner',
      daysToDue, daysLate: null, flag: false };
  }
  return { ...base, status: 'Open', rgy: 'Green', sev: 'Normal', esc: 'Neutral', escRating: 0, risk: 10, alert: '',
    nextAction: 'Track in routine review', daysToDue, daysLate: null, flag: false };
}

// { label, tone } for a task: tone is its RYGB key, label the plain-language name.
function getTaskStatusPresentation(task) {
  const key = rygbOf(task);
  return { label: RYGB[key].label, tone: key };
}

// Row background tone: the RYGB key.
function getTaskRowTone(task) {
  return rygbOf(task);
}

function dueSoonAlerts(tasks, maxDays = 5) {
  return tasks.filter((task) => {
    if (!task || task.status === 'Closed') return false;
    if (task.daysToDue === null || task.daysToDue === undefined) return false;
    return task.daysToDue >= 0 && task.daysToDue <= maxDays;
  });
}

export { parseDate, fmtDate, fmtShort, startOfToday, ESCALATION_STAGES, RYGB, RYGB_ORDER, DUE_SOON_DAYS, LEGACY_STATUS_LABELS, rygbOf, deriveTask, dueSoonAlerts, getTaskStatusPresentation, getTaskRowTone, escalationRating };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseDate,
    fmtDate,
    fmtShort,
    startOfToday,
    ESCALATION_STAGES,
    RYGB,
    RYGB_ORDER,
    DUE_SOON_DAYS,
    LEGACY_STATUS_LABELS,
    rygbOf,
    deriveTask,
    dueSoonAlerts,
    getTaskStatusPresentation,
    getTaskRowTone,
    escalationRating,
  };
}
