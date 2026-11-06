// The employee list behind the owner dropdown. Mirrors migration 0015_employees.sql: names are
// compared after normalising (lower case, single spaces), and "Yogita Salunke" is treated as a
// spelling of "Yogita Salunkhe" (same first letter, at most 2 letters apart).
const { normName, ownerTokens } = require('./owners.js');

const NOT_A_PERSON = /^(unassigned|tbd|na|n\/a|-|all|team)$/;
const SPLIT = /\s*[/,&;+]\s*/;

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const reversed = (n) => n.split(' ').reverse().join(' ');
const tidy = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// True when tracker name `n` (normalised) is clearly the listed person `e` (normalised).
function isSamePerson(n, e) {
  if (n === e || n === reversed(e)) return true;
  if (!n.includes(' ') && e.split(' ').includes(n)) return true;
  return n.length >= 8 && n[0] === e[0] && levenshtein(n, e) <= 2;
}

// The listed person a tracker spelling most likely means, or null when there is none or more than
// one equally likely person (for example "Vishal" when both Vishal Pawar and Vishal Shinde are listed).
function closestEmployee(name, employees) {
  const n = normName(name);
  if (!n) return null;
  let best = null;
  let tie = false;
  employees.forEach((emp) => {
    const e = normName(emp.name);
    if (!e || e === n || emp.active === false || !isSamePerson(n, e)) return;
    const d = n.includes(' ') ? levenshtein(n, e) : 0;
    if (!best || d < best.d) { best = { emp, d }; tie = false; } else if (d === best.d) tie = true;
  });
  return best && !tie ? best.emp : null;
}

// Builds an employee list from tracker Owner cells, the same way the migration fills it once:
// full names first (most used first), then single names that are not part of a listed full name.
function employeesFromOwners(ownerCells, existing = []) {
  const counts = new Map();
  ownerCells.forEach((cell) => String(cell ?? '').split(SPLIT).forEach((raw) => {
    const spelling = tidy(raw);
    const n = normName(spelling);
    if (!n || NOT_A_PERSON.test(n)) return;
    const entry = counts.get(n) || { n, uses: 0, spellings: new Map() };
    entry.uses += 1;
    entry.spellings.set(spelling, (entry.spellings.get(spelling) || 0) + 1);
    counts.set(n, entry);
  }));
  const out = [...existing];
  [...counts.values()]
    .sort((a, b) => Number(b.n.includes(' ')) - Number(a.n.includes(' ')) || b.uses - a.uses || a.n.localeCompare(b.n))
    .forEach((entry) => {
      if (out.some((emp) => isSamePerson(entry.n, normName(emp.name)))) return;
      const spelling = [...entry.spellings.keys()].sort()[0];
      const name = /[A-Z]/.test(spelling) ? spelling : spelling.replace(/\b\w/g, (c) => c.toUpperCase());
      out.push({ name, email: null, department: null, active: true });
    });
  return out;
}

// The owner field holds "Name / Name / partial". The picker suggests names for the last part.
function ownerSegments(value) {
  const parts = String(value ?? '').split(SPLIT);
  const current = parts.pop() ?? '';
  return { done: parts.map(tidy).filter(Boolean), current: current.trimStart() };
}

function withSuggestion(value, name) {
  const { done } = ownerSegments(value);
  const names = [...done.filter((d) => normName(d) !== normName(name)), name];
  return names.join(' / ');
}

function suggestEmployees(employees, query, exclude = [], limit = 8) {
  const q = normName(query) || '';
  const skip = new Set(exclude.map(normName));
  const scored = [];
  employees.forEach((emp) => {
    if (emp.active === false) return;
    const n = normName(emp.name);
    if (!n || skip.has(n)) return;
    let rank;
    if (!q) rank = 2;
    else if (n.startsWith(q)) rank = 0;
    else if (n.split(' ').some((w) => w.startsWith(q)) || (emp.email || '').toLowerCase().startsWith(q)) rank = 1;
    else if (n.includes(q)) rank = 2;
    else return;
    scored.push({ emp, rank });
  });
  return scored.sort((a, b) => a.rank - b.rank || a.emp.name.localeCompare(b.emp.name)).slice(0, limit).map((s) => s.emp);
}

// Names in an Owner value that are not on the employee list (shown as a gentle warning).
function unknownOwnerNames(owner, employees) {
  const known = new Set(employees.filter((e) => e.active !== false).map((e) => normName(e.name)));
  return String(owner ?? '').split(SPLIT).map(tidy)
    .filter((name) => { const n = normName(name); return n && !NOT_A_PERSON.test(n) && !known.has(n); });
}

// Same as public.replace_owner_name: swaps one spelling, keeps the order, drops duplicates.
function replaceOwnerName(owner, from, to) {
  const f = normName(from);
  const seen = new Set();
  const names = [];
  String(owner ?? '').split(SPLIT).forEach((raw) => {
    const name = normName(raw) === f ? tidy(to) : tidy(raw);
    const n = normName(name);
    if (!n || seen.has(n)) return;
    seen.add(n);
    names.push(name);
  });
  return names.length ? names.join(' / ') : 'Unassigned';
}

// Owner spellings used in the visible issues that are not on the list, with how often they are
// used and the listed person they most likely mean. Feeds the clean-up table on the People page.
function ownerSpellingsReport(tasks, employees) {
  const known = new Set(employees.map((e) => normName(e.name)));
  const found = new Map();
  tasks.forEach((t) => String(t.owner ?? '').split(SPLIT).forEach((raw) => {
    const name = tidy(raw);
    const n = normName(name);
    if (!n || NOT_A_PERSON.test(n) || known.has(n)) return;
    const row = found.get(n) || { name, uses: 0, trackers: new Set() };
    row.uses += 1;
    if (t.manager) row.trackers.add(t.manager);
    found.set(n, row);
  }));
  return [...found.values()]
    .map((row) => ({ name: row.name, uses: row.uses, trackers: [...row.trackers].sort(), suggestion: closestEmployee(row.name, employees) }))
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
}

module.exports = {
  levenshtein, isSamePerson, closestEmployee, employeesFromOwners, ownerSegments, withSuggestion,
  suggestEmployees, unknownOwnerNames, replaceOwnerName, ownerSpellingsReport, ownerTokens,
};
