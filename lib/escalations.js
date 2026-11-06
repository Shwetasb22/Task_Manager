const { isOwnerOf, normName } = require('./owners');

// Escalation levels come from lib/rules.js deriveTask (date-driven):
//   L1 Owner   – up to 7 days past target  → the assigned owner(s)
//   L2 Manager – due within 3 days         → the tracker's Platform Manager
//   L3 HOD     – more than 7 days past due → the department head of the issue's department
const ESCALATION_LABELS = Object.freeze({
  'L1 Owner': 'L1 · Owner',
  'L2 Manager': 'L2 · Manager',
  'L3 HOD': 'L3 · Dept Head',
});

// Badge colours per level (Tailwind classes), most severe last.
const ESCALATION_TONES = Object.freeze({
  'L1 Owner': 'bg-[#C8102E] text-white', // up to 7 days overdue → Red
  'L2 Manager': 'bg-[#E0A800] text-[#241a00]', // due within 3 days → Yellow
  'L3 HOD': 'bg-[#8E0B20] text-white', // more than 7 days overdue → deep Red
});

function isEscalationRecipient(task, session) {
  if (!task || !session || task.status === 'Closed' || !ESCALATION_LABELS[task.esc]) return false;
  if (session.role === 'Admin') return true;

  if (task.esc === 'L1 Owner') {
    return session.role === 'Owner' && isOwnerOf(session, task);
  }
  if (task.esc === 'L2 Manager') {
    return session.role === 'Manager' && normName(session.name) === normName(task.manager);
  }
  if (task.esc === 'L3 HOD') {
    if (session.role !== 'Dept Head') return false;
    const department = normName(session.dept || session.department);
    return !department || department === 'all' || department === normName(task.dept);
  }
  return false;
}

// Plain-language "who this escalation is sent to", e.g. "Owner: Anjali Iyer".
function escalationTarget(task) {
  if (!task || !ESCALATION_LABELS[task.esc]) return '';
  if (task.esc === 'L1 Owner') return `Owner: ${task.owner || 'Unassigned'}`;
  if (task.esc === 'L2 Manager') return `Manager: ${task.manager || 'Unassigned'}`;
  return `Dept Head: ${task.dept && task.dept !== 'Unassigned' ? task.dept : 'department'}`;
}

// Open escalations addressed to this person, most severe and most late first.
function escalationsFor(tasks, session) {
  return (tasks || [])
    .filter((task) => isEscalationRecipient(task, session))
    .sort((a, b) => (b.escRating || 0) - (a.escRating || 0) || (b.daysLate || 0) - (a.daysLate || 0));
}

// { 'L3 HOD': n, 'L2 Manager': n, 'L1 Owner': n } for a list of escalated tasks.
function countByLevel(tasks) {
  const counts = { 'L3 HOD': 0, 'L2 Manager': 0, 'L1 Owner': 0 };
  (tasks || []).forEach((task) => { if (task.esc in counts) counts[task.esc] += 1; });
  return counts;
}

module.exports = { ESCALATION_LABELS, ESCALATION_TONES, isEscalationRecipient, escalationTarget, escalationsFor, countByLevel };
