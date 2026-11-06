// Helpers for the "Add issue" form: validation, tidy-up and (demo mode only) id numbering.
// In production the database generates the id and re-checks every rule (migration 0010 / 0027).
const { revisedDateError } = require('./due-policy');

// Departments offered in the form, in addition to any already used in the tracker.
const DEFAULT_DEPARTMENTS = ['PRGM', 'PE', 'PRCE', 'PBYR', 'QE', 'LOG', 'KAM', 'CE'];

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateNewIssue(form) {
  const errors = {};
  const issue = {
    manager: clean(form.manager),
    customer: clean(form.customer),
    program: clean(form.program),
    desc: clean(form.desc),
    dept: clean(form.dept),
    owner: clean(form.owner),
    start: form.start || null,
    due: form.due || null,
    next: form.next || null,
    remark: String(form.remark ?? '').trim(),
    initialManager: clean(form.initialManager || form.manager),
    member: clean(form.member),
  };

  if (!issue.manager) errors.manager = 'Choose the tracker this issue belongs to.';
  if (!issue.program) errors.program = 'Program is required.';
  if (!issue.desc) errors.desc = 'Describe the issue.';
  else if (issue.desc.length > 1000) errors.desc = 'Keep the description under 1000 characters.';
  if (!issue.dept) errors.dept = 'Choose a department.';
  if (!issue.owner) errors.owner = 'Enter the resource (owner) name.';
  if (!issue.start) errors.start = 'Start date is required.';
  if (!issue.due) errors.due = 'Target date is required.';

  ['start', 'due', 'next'].forEach((k) => {
    if (issue[k] && !DATE_RE.test(issue[k])) errors[k] = 'Use a valid date.';
  });
  if (!errors.start && !errors.due && issue.start && issue.due && issue.due < issue.start) {
    errors.due = 'Target date cannot be before the start date.';
  }
  if (!errors.due && !errors.next && issue.due && issue.next) {
    const nextError = revisedDateError(issue.due, issue.next);
    if (nextError) errors.next = nextError;
  }

  return { ok: Object.keys(errors).length === 0, errors, issue };
}

// Prefix this tracker already uses (SI, AB, ...), else the manager's initials.
function issuePrefix(tasks, manager) {
  const existing = tasks.find((t) => t.manager === manager && /^[A-Za-z]+-\d+$/.test(t.id));
  if (existing) return existing.id.split('-')[0];
  const letters = String(manager || '').replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean);
  const initials = letters.map((w) => w[0]).join('').toUpperCase();
  if (initials.length >= 2) return initials;
  return (String(manager || '').replace(/[^A-Za-z]/g, '') + 'XX').slice(0, 2).toUpperCase();
}

// usedIds: numbers given out before and since deleted, so they are never handed out again
// (the database keeps a counter for this, migration 0024).
function nextIssueId(tasks, manager, usedIds = []) {
  const prefix = issuePrefix(tasks, manager);
  const re = new RegExp(`^${prefix}-(\\d{1,9})$`);
  const max = [...tasks.map((t) => t.id), ...usedIds].reduce((m, id) => {
    const hit = re.exec(id);
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0);
  return `${prefix}-${max + 1}`;
}

function sortNewestFirst(tasks) {
  return [...tasks].sort((a, b) => {
    const aCreated = Date.parse(a.createdAt || '');
    const bCreated = Date.parse(b.createdAt || '');
    const aHasCreated = Number.isFinite(aCreated);
    const bHasCreated = Number.isFinite(bCreated);

    if (aHasCreated && bHasCreated && aCreated !== bCreated) return bCreated - aCreated;
    if (aHasCreated !== bHasCreated) return Number(bHasCreated) - Number(aHasCreated);
    return String(b.id || '').localeCompare(String(a.id || ''), undefined, { numeric: true });
  });
}

function sortBySerial(tasks) {
  return [...tasks].sort((a, b) => {
    const left = String(a.srNo ?? '').trim();
    const right = String(b.srNo ?? '').trim();
    if (!left && right) return 1;
    if (left && !right) return -1;
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    const compared = left && right && Number.isFinite(leftNumber) && Number.isFinite(rightNumber)
      ? leftNumber - rightNumber
      : left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' });
    return compared || String(a.id || '').localeCompare(String(b.id || ''), undefined, { numeric: true });
  });
}

module.exports = { DEFAULT_DEPARTMENTS, validateNewIssue, issuePrefix, nextIssueId, sortNewestFirst, sortBySerial };
