// "Import from Excel": turns a manager's tracker sheet into a plan of issues to add and update.
// Nothing is written here; the page shows the plan, and only applies it after the person confirms.
//
// Rules (kept deliberately safe, because the app is the source of truth):
// - A row matches an existing issue by its ID (SI-12, or Sr No 12 in the SI tracker) when the program
//   or description also matches, otherwise by the same program + description.
// - Matched issues: filled-in Excel cells update the issue. Empty cells never clear anything.
// - Closed issues were previously skipped because closing in the app requires proof; imports now
//   preserve the supplied status and close date so historical closed work is not lost.
// - Overdue is derived from the target date, not trusted from the workbook's status text.
// - New rows become new issues with the next ID unless Excel supplies a usable issue ID.
// - Nothing is ever deleted.

const HEADER_ALIASES = {
  id: ['issue id', 'issueid', 'id', 'tracker id', 'opl id'],
  sr: ['sr no', 'sr', 'sr. no', 'sno', 's no', 'serial no', 'serial number', 'sl no'],
  customer: ['customer', 'customer name'],
  program: ['program name', 'program', 'programme', 'project', 'project name'],
  desc: ['issue description', 'description', 'issue desc', 'issue descirption', 'issue', 'open point'],
  dept: ['dept', 'department', 'department name', 'dept name', 'function'],
  owner: ['owner', 'resource', 'resource name', 'responsible', 'responsibility'],
  member: ['member'],
  start: ['start date', 'start', 'open date', 'opened on'],
  due: ['target date', 'due date', 'target', 'due'],
  next: ['next date', 'revised target', 'revised target date', 'revised date'],
  closed: ['actual close date', 'closed date', 'close date', 'closure date', 'actual closure date'],
  status: ['status', 'issue status', 'task status'],
  remark: ['remarks', 'remark', 'comment', 'comments'],
};
const ALIAS = Object.fromEntries(
  Object.entries(HEADER_ALIASES).flatMap(([field, names]) => names.map((n) => [n, field])),
);

// Column positions of the standard Brembo OPL tracker, used when the sheet has no usable header row.
const STANDARD_LAYOUT = { sr: 0, program: 1, desc: 2, dept: 3, owner: 4, start: 5, due: 6, next: 7, closed: 8, status: 10, remark: 13, member: 17 };

const FIELD_LABELS = {
  customer: 'Customer', program: 'Program', desc: 'Description', dept: 'Department', owner: 'Owner',
  member: 'Member', start: 'Start date', due: 'Target date', next: 'Next date', closed: 'Actual close date',
  sourceStatus: 'Status', remark: 'Remarks',
};
const UPDATE_FIELDS = Object.keys(FIELD_LABELS);
const DATE_FIELDS = new Set(['start', 'due', 'next', 'closed']);

const clean = (v) => String(v ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const normalizeHeader = (v) => clean(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();
const textKey = (program, desc) => `${clean(program).toLowerCase()}|${clean(desc).toLowerCase()}`;

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');

function validYmd(y, m, d) {
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 2000 || y > 2100) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

// Excel serial numbers, ISO dates, 12-May-26, 12/05/2026 (day first, as used in India). Returns
// 'YYYY-MM-DD', null for an empty cell, or undefined when the cell has something that is not a date.
function toIsoDate(value) {
  if (value === null || value === undefined || clean(value) === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : validYmd(value.getFullYear(), value.getMonth() + 1, value.getDate()) || undefined;
  if (typeof value === 'number') {
    if (value < 20000 || value > 80000) return undefined;
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86400000);
    return validYmd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()) || undefined;
  }
  const s = clean(value);
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(s);
  if (m) return validYmd(+m[1], +m[2], +m[3]) || undefined;
  m = /^(\d{1,2})[-\s/.]([A-Za-z]{3,4})[A-Za-z]*[-\s/.,]+(\d{2,4})$/.exec(s);
  if (m && MONTHS[m[2].toLowerCase()]) return validYmd(+m[3], MONTHS[m[2].toLowerCase()], +m[1]) || undefined;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s);
  if (m) return validYmd(+m[3], +m[2], +m[1]) || undefined;
  if (/^\d+(\.\d+)?$/.test(s)) return toIsoDate(Number(s));
  return undefined;
}

function mapHeader(row) {
  const map = {};
  (row || []).forEach((cell, index) => {
    const field = ALIAS[normalizeHeader(cell)];
    if (field && map[field] === undefined) map[field] = index;
  });
  return map;
}

// Finds the header row in the first rows of a sheet. Falls back to the standard tracker layout.
function detectColumns(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i += 1) {
    const map = mapHeader(rows[i]);
    if (map.program !== undefined && map.desc !== undefined) return { map, firstDataRow: i + 1, guessed: false };
  }
  const looksLikeData = (r) => r && clean(r[1]) && clean(r[2]) && (toIsoDate(r[5]) || toIsoDate(r[6]));
  const first = rows.findIndex((r, i) => i < 15 && looksLikeData(r));
  if (first === -1) return null;
  return { map: { ...STANDARD_LAYOUT }, firstDataRow: first, guessed: true };
}

function normalizeStatus(value) {
  const status = normalizeHeader(value);
  if (!status) return '';
  if (/^(closed|close|complete|completed|done)$/.test(status)) return 'Closed';
  if (/^(overdue|late|delayed)$/.test(status)) return 'Open';
  if (/^(in progress|inprogress|ongoing|working)$/.test(status)) return 'In Progress';
  if (/^(open|pending|not started)$/.test(status)) return 'Open';
  return status.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

// sheets: output of readWorkbook. Returns { sheetName, guessedLayout, rows: [{ rowNumber, ... }], warnings }.
function parseTracker(sheets, { normalizeDept = (d) => clean(d) } = {}) {
  if (!(sheets || []).length) {
    throw new Error('No issue list was found. The sheet needs columns for Program Name and Issue Description.');
  }
  const rows = [];
  const warnings = [];
  const ignoredRows = [];
  let emptyRowsSkipped = 0;
  let duplicateRowsSkipped = 0;
  const seenRows = new Map();
  for (const sheet of sheets) {
    const detected = detectColumns(sheet.rows);
    if (!detected) {
      const nonEmptyRows = (sheet.rows || []).map((cells, index) => ({ cells, index }))
        .filter(({ cells }) => cells.some((cell) => clean(cell)));
      emptyRowsSkipped += (sheet.rows || []).length - nonEmptyRows.length;
      if (nonEmptyRows.length) {
        warnings.push(`Sheet "${sheet.name}" has no recognizable issue columns; its non-empty rows were not imported.`);
        nonEmptyRows.forEach(({ index }) => ignoredRows.push({
          sheetName: sheet.name, rowNumber: index + 1, reason: `Sheet "${sheet.name}" has no recognizable issue columns.`,
        }));
      }
      continue;
    }
    const { map, firstDataRow, guessed } = detected;
    if (guessed) warnings.push(`Sheet "${sheet.name}" has no header row, so the standard OPL tracker column order was used. Check the preview before importing.`);
    for (let i = firstDataRow; i < sheet.rows.length; i += 1) {
      const r = sheet.rows[i] || [];
      if (!r.some((cell) => clean(cell))) {
        emptyRowsSkipped += 1;
        continue;
      }
      const get = (field) => (map[field] === undefined ? null : r[map[field]]);
      const row = {
        sheetName: sheet.name,
        rowNumber: i + 1,
        program: clean(get('program')),
        desc: clean(get('desc')),
        problems: [],
      };
      const idText = clean(get('id'));
      const srText = clean(get('sr'));
      row.id = /^[A-Za-z]+-[-\d]+$/.test(idText) ? idText.toUpperCase() : null;
      const srSource = srText || (!row.id ? idText : '');
      row.sr = /^-?\d+(\.0+)?$/.test(srSource) ? String(parseInt(srSource, 10)) : null;
      row.customer = clean(get('customer'));
      row.dept = clean(get('dept')) ? normalizeDept(clean(get('dept'))) : '';
      row.owner = clean(get('owner'));
      row.member = clean(get('member'));
      const workbookStatus = get('status');
      row.sourceStatus = normalizeStatus(workbookStatus);
      row.remark = String(get('remark') ?? '').replace(/ /g, ' ').trim();
      DATE_FIELDS.forEach((field) => {
        const iso = toIsoDate(get(field));
        if (iso === undefined) {
          row[field] = null;
          row.problems.push(`${field === 'closed' ? 'Close date' : FIELD_LABELS[field]} "${clean(get(field))}" is not a date and was ignored.`);
        } else row[field] = iso;
      });
      if (/^(overdue|late|delayed)$/.test(normalizeHeader(workbookStatus))) {
        row.problems.push('Overdue is derived from the target date and close status; the imported status will follow the dates.');
      }
      if (!row.program && !row.desc) {
        ignoredRows.push({
          sheetName: sheet.name, rowNumber: i + 1,
          reason: 'No program or description was provided; this row was not imported.',
        });
        continue;
      }
      const duplicateKey = JSON.stringify([
        row.id, row.sr, row.customer, row.program, row.desc, row.dept, row.owner, row.member,
        row.start, row.due, row.next, row.closed, row.sourceStatus, row.remark,
        row.problems,
      ].map((value) => clean(value).toLowerCase()));
      const original = seenRows.get(duplicateKey);
      if (original) {
        duplicateRowsSkipped += 1;
        ignoredRows.push({
          sheetName: sheet.name, rowNumber: i + 1,
          reason: `Repeated row; identical data was already read from ${original.sheetName}, row ${original.rowNumber}.`,
        });
        continue;
      }
      seenRows.set(duplicateKey, { sheetName: sheet.name, rowNumber: i + 1 });
      rows.push(row);
    }
  }
  return {
    sheetName: (sheets || []).map((sheet) => sheet.name).join(', '),
    sheetCount: (sheets || []).length,
    emptyRowsSkipped,
    duplicateRowsSkipped,
    ignoredRows,
    guessedLayout: warnings.some((warning) => warning.includes('standard OPL tracker column order')),
    rows,
    warnings,
  };
}

// tasks: issues already in the app for this tracker. prefix: the tracker's ID prefix (SI, AB, ...).
// Returns { items: [{ kind: 'add'|'update'|'same'|'skip', row, task?, changes?, notes, reason? }], counts }.
function planImport(parsed, tasks, { prefix, normalizeDept = (d) => clean(d) } = {}) {
  const byId = new Map(tasks.map((t) => [String(t.id).toUpperCase(), t]));
  const byText = new Map(); // the same program + description can appear on more than one issue
  tasks.forEach((t) => { const k = textKey(t.program, t.desc); byText.set(k, [...(byText.get(k) || []), t]); });
  const seen = new Set();
  const items = [];

  for (const row of parsed.rows) {
    const notes = [...row.problems];
    if (row.rowError) notes.push(row.rowError);
    const candidateId = row.id || (row.sr !== null && prefix ? `${prefix}-${row.sr}`.toUpperCase() : null);
    let task = candidateId ? byId.get(candidateId) : undefined;
    if (!task) {
      const matches = byText.get(textKey(row.program, row.desc)) || [];
      // Among look-alike issues, take the unused one that agrees with this row on the most details.
      const score = (t) => ['owner', 'start', 'due'].filter((f) => row[f] && same(t[f], row[f])).length
        + (row.dept && same(normalizeDept(t.dept), row.dept) ? 1 : 0);
      const free = matches.filter((t) => !seen.has(`task:${t.id}`)).sort((a, b) => score(b) - score(a));
      task = free[0] || matches[0];
    }

    const key = task ? `task:${task.id}` : `text:${textKey(row.program, row.desc)}`;
    seen.add(key);

    if (task) {
      const changes = {};
      UPDATE_FIELDS.forEach((field) => {
        const next = row[field];
        if (next === null || next === undefined || next === '') return;
        const current = field === 'dept' && task.dept ? normalizeDept(task.dept) : task[field];
        const unchanged = DATE_FIELDS.has(field) ? (current || null) === next : same(current, next) && (field !== 'remark' || clean(current) === clean(next));
        if (!unchanged) changes[field] = { from: current ?? null, to: next };
      });
      if (row.closed && !task.closed) notes.push(`Closed in Excel on ${row.closed}. Close it in the app once proof is attached.`);
      items.push({ kind: Object.keys(changes).length ? 'update' : 'same', row, task, changes, notes });
      continue;
    }

    items.push({ kind: 'add', row, notes });
  }

  const counts = { add: 0, update: 0, same: 0, skip: 0 };
  items.forEach((item) => { counts[item.kind] += 1; });
  return { items, counts };
}

// The issue to create for an 'add' item (same shape as the Add issue form).
function issueFromRow(row, manager, prefix) {
  return {
    id: row.id || (row.sr !== null && prefix ? `${prefix}-${row.sr}`.toUpperCase() : null),
    manager,
    customer: row.customer,
    program: row.program,
    desc: row.desc,
    dept: row.dept || 'Unassigned',
    owner: row.owner || 'Unassigned',
    member: row.member || row.owner || '',
    start: row.start,
    due: row.due,
    next: row.next,
    closed: row.closed,
    sourceStatus: row.sourceStatus || '',
    remark: row.remark,
  };
}

// The patch for an 'update' item (field -> new value).
function patchFromChanges(changes) {
  return Object.fromEntries(Object.entries(changes).map(([field, change]) => [field, change.to]));
}

module.exports = { FIELD_LABELS, toIsoDate, detectColumns, parseTracker, planImport, issueFromRow, patchFromChanges };
