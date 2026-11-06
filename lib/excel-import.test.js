const test = require('node:test');
const assert = require('node:assert/strict');
const { zipSync, strToU8 } = require('fflate');
const { readWorkbook } = require('./xlsx-reader');
const { toIsoDate, parseTracker, planImport, issueFromRow, patchFromChanges } = require('./excel-import');

// Smallest valid .xlsx: one sheet, shared strings plus inline numbers (dates are Excel serials).
function makeXlsx(rows) {
  const strings = [];
  const cell = (v, r, c) => {
    const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
    if (v === null) return '';
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    strings.push(v);
    return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
  };
  const sheet = rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c)).join('')}</row>`).join('');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return zipSync({
    'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Cover" sheetId="1" r:id="rId1"/><sheet name="OPEN_ISSUE_TRACKER" sheetId="2" r:id="rId2"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8('<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Cover</t></is></c></row></sheetData></worksheet>'),
    'xl/worksheets/sheet2.xml': strToU8(`<worksheet><sheetData>${sheet}</sheetData></worksheet>`),
    'xl/sharedStrings.xml': strToU8(`<sst>${strings.map((s) => `<si><t>${esc(s)}</t></si>`).join('')}</sst>`),
  });
}

const HEADER = ['Sr No', 'Program Name', 'Issue Description', 'Dept', 'Owner', 'Start Date', 'Target Date', 'Next Date', 'Actual Close Date', 'Days Pending', 'Status', 'RGY', 'Alert', 'Remarks'];
const MAY_12 = 46154; // Excel serial for 2026-05-12

test('dates from Excel serials and common text formats', () => {
  assert.equal(toIsoDate(MAY_12), '2026-05-12');
  assert.equal(toIsoDate('12-May-26'), '2026-05-12');
  assert.equal(toIsoDate('12/05/2026'), '2026-05-12');
  assert.equal(toIsoDate('2026-05-12'), '2026-05-12');
  assert.equal(toIsoDate(''), null);
  assert.equal(toIsoDate('next week'), undefined);
  assert.equal(toIsoDate('31/02/2026'), undefined);
});

test('reads the OPEN_ISSUE_TRACKER sheet of an xlsx by its header names', () => {
  const bytes = makeXlsx([
    ['Brembo OPL tracker', null],
    HEADER,
    [1, 'KTM_FIX', 'Release drawing & BOM', 'ENGG', 'Yash', MAY_12, MAY_12 + 3, null, null, 3, 'Open', 'Red', null, 'Waiting <supplier>'],
    [null, null, null],
  ]);
  const parsed = parseTracker(readWorkbook(bytes, 'tracker.xlsx'), { normalizeDept: (d) => (d === 'ENGG' ? 'PE' : d) });
  assert.equal(parsed.sheetName, 'Cover, OPEN_ISSUE_TRACKER');
  assert.equal(parsed.guessedLayout, false);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.ignoredRows.length, 1);
  assert.equal(parsed.emptyRowsSkipped, 1);
  assert.deepEqual(
    { ...parsed.rows[0], problems: undefined },
    { sheetName: 'OPEN_ISSUE_TRACKER', rowNumber: 3, program: 'KTM_FIX', desc: 'Release drawing & BOM', id: null, sr: '1', customer: '', dept: 'PE', owner: 'Yash', member: '', sourceStatus: 'Open', remark: 'Waiting <supplier>', start: '2026-05-12', due: '2026-05-15', next: null, closed: null, problems: undefined },
  );
});

test('skips blank and data-free rows and removes only exact repeated rows', () => {
  const record = [1, 'KTM', 'Review drawing', 'PE', 'Yash', MAY_12, MAY_12 + 3, null, null, null, 'Open', null, null, 'Waiting for supplier'];
  const parsed = parseTracker([
    { name: 'Open', rows: [HEADER, record, [], [null, null, null], [null, null, '  '], [null, null, null, null, 'Yash'], [...record]] },
    { name: 'More', rows: [HEADER, [...record, ''], [2, 'KTM', 'Review drawing', 'PE', 'Ravi', MAY_12, MAY_12 + 3, null, null, null, 'Open']] },
  ]);

  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.emptyRowsSkipped, 3);
  assert.equal(parsed.duplicateRowsSkipped, 2);
  assert.equal(parsed.ignoredRows.length, 3);
  assert.equal(parsed.rows[0].owner, 'Yash');
  assert.equal(parsed.rows[0].remark, 'Waiting for supplier');
  assert.equal(parsed.rows[1].owner, 'Ravi');
  assert.ok(parsed.ignoredRows.some(({ reason }) => /No program or description/.test(reason)));
  assert.ok(parsed.ignoredRows.filter(({ reason }) => /Repeated row/.test(reason)).length === 2);
});

test('sheet without a header row uses the standard tracker layout and says so', () => {
  const bytes = makeXlsx([[-5, 'Quasar_FLOAT', 'Validate tooling plan', 'PM-BI', 'Abhijit', MAY_12, MAY_12, null, null]]);
  const parsed = parseTracker(readWorkbook(bytes, 'a.xlsx'));
  assert.equal(parsed.guessedLayout, true);
  assert.equal(parsed.rows[0].sr, '-5');
  assert.ok(parsed.warnings.some((warning) => /no header row/.test(warning)));
});

test('CSV with semicolons and Windows-1252 text', () => {
  const text = 'Sr No;Program Name;Issue Description;Resource Name;Target Date\r\n7;KTM;Confirm \x96 supplier;Vishal;15-May-26\r\n';
  const parsed = parseTracker(readWorkbook(Uint8Array.from(text, (c) => c.charCodeAt(0)), 't.csv'));
  assert.equal(parsed.rows[0].desc, 'Confirm – supplier');
  assert.equal(parsed.rows[0].owner, 'Vishal');
  assert.equal(parsed.rows[0].due, '2026-05-15');
});

test('old .xls files get a clear message', () => {
  assert.throws(() => readWorkbook(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0]), 'old.xls'), /Save As/);
});

const tasks = [
  { id: 'SI-1', manager: 'Sagar Ingle', program: 'KTM_FIX', desc: 'Release drawing', dept: 'PE', owner: 'Yash', due: '2026-05-15', closed: null, remark: '' },
  { id: 'SI-2', manager: 'Sagar Ingle', program: 'KTM_FIX', desc: 'Supplier feasibility', dept: 'PBYR', owner: 'Vishal', due: '2026-05-18', closed: '2026-05-20', remark: 'done' },
  { id: 'SI-3', manager: 'Sagar Ingle', program: 'Other', desc: 'Added in the app', dept: 'QE', owner: 'Amit', due: null, closed: null, remark: '' },
];
const row = (over) => ({ rowNumber: 2, id: null, sr: null, program: '', desc: '', customer: '', dept: '', owner: '', member: '', remark: '', start: null, due: null, next: null, closed: null, problems: [], ...over });

test('plan: imports closed and open rows, upserts by ID, and leaves blank cells unchanged', () => {
  const parsed = { rows: [
    row({ rowNumber: 2, sr: '1', program: 'KTM_FIX', desc: 'Release drawing', owner: 'yash', due: '2026-05-25', closed: '2026-05-30' }),
    row({ rowNumber: 3, sr: '2', program: 'KTM_FIX', desc: 'Supplier feasibility', owner: 'Someone else', remark: '' }),
    row({ rowNumber: 4, sr: '3', program: 'KTM_FIX', desc: 'New from Excel', owner: 'Ravi', due: '2026-06-01' }),
    row({ rowNumber: 5, sr: '9', program: 'KTM_FIX', desc: 'Old closed point', closed: '2026-05-01' }),
    row({ rowNumber: 6, program: 'KTM_FIX', desc: 'Release drawing' }),
    row({ rowNumber: 7, program: 'KTM_FIX', desc: 'Bad dates', start: '2026-06-10', due: '2026-06-01' }),
  ] };
  const { items, counts } = planImport(parsed, tasks, { prefix: 'SI' });
  assert.deepEqual(counts, { add: 2, update: 3, same: 1, skip: 0 });

  // Sr No 1 -> SI-1: target and close dates are imported.
  assert.equal(items[0].task.id, 'SI-1');
  assert.deepEqual(items[0].changes, {
    due: { from: '2026-05-15', to: '2026-05-25' },
    closed: { from: null, to: '2026-05-30' },
  });
  assert.deepEqual(patchFromChanges(items[0].changes), { due: '2026-05-25', closed: '2026-05-30' });

  // An existing closed issue is still updated from the workbook.
  assert.equal(items[1].kind, 'update');
  assert.equal(items[1].changes.owner.to, 'Someone else');

  // Excel IDs are canonical and update their matching issue.
  assert.equal(items[2].kind, 'update');
  assert.equal(items[2].task.id, 'SI-3');
  assert.equal(items[3].kind, 'add');
  assert.deepEqual(issueFromRow(items[2].row, 'Sagar Ingle', 'SI'), {
    id: 'SI-3', manager: 'Sagar Ingle', customer: '', program: 'KTM_FIX', desc: 'New from Excel', dept: 'Unassigned',
    owner: 'Ravi', member: 'Ravi', start: null, due: '2026-06-01', next: null, remark: '',
    closed: null, sourceStatus: '',
  });

  assert.equal(items[4].kind, 'same');
  assert.equal(items[5].kind, 'add');
});

test('parses every sheet and keeps blank owners and target dates while normalizing statuses', () => {
  const parsed = parseTracker([
    { name: 'Open', rows: [HEADER, [1, 'A', 'Open work', 'PE', '', null, null, null, null, null, 'open']] },
    { name: 'Closed', rows: [HEADER, [2, 'B', 'Done work', 'QE', '', null, null, null, MAY_12, null, 'closed']] },
    { name: 'Progress', rows: [HEADER, [3, 'C', 'Active work', 'LOG', 'Owner', null, MAY_12 + 4, null, null, null, 'in progress'], []] },
    { name: 'Overdue', rows: [HEADER, [4, 'D', 'Late work', 'QA', 'Owner', null, MAY_12 - 1, null, null, null, 'overdue']] },
  ]);
  assert.equal(parsed.rows.length, 4);
  assert.deepEqual(parsed.rows.map((item) => item.sourceStatus), ['Open', 'Closed', 'In Progress', 'Open']);
  assert.equal(parsed.rows[0].owner, '');
  assert.equal(parsed.rows[0].due, null);
  assert.equal(parsed.rows[1].closed, '2026-05-12');
  assert.match(parsed.rows[3].problems[0], /Overdue is derived/);
  assert.equal(parsed.rows[3].due, '2026-05-11');
  assert.equal(parsed.emptyRowsSkipped, 1);
});

test('plan: empty cells never erase a value', () => {
  const parsed = { rows: [row({ sr: '1', program: 'KTM_FIX', desc: 'Release drawing', owner: '', due: null })] };
  assert.equal(planImport(parsed, [{ ...tasks[0], remark: 'keep me' }], { prefix: 'SI' }).counts.same, 1);
});

test('re-importing the same workbook 10 times is idempotent', () => {
  const parsed = parseTracker([{
    name: 'Tracker',
    rows: [
      HEADER,
      [1, 'KTM_FIX', 'Release drawing', 'PE', 'Yash', MAY_12, MAY_12 + 10, null, null, null, 'Open'],
      [4, 'KTM_FIX', 'Validate supplier plan', 'QE', 'Amit', MAY_12, MAY_12 + 20, null, null, null, 'Open'],
      [4, 'KTM_FIX', 'Validate supplier plan', 'QE', 'Amit', MAY_12, MAY_12 + 20, null, null, null, 'Open'],
    ],
  }]);
  let importedTasks = [{ ...tasks[0] }];

  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.duplicateRowsSkipped, 1);

  for (let iteration = 0; iteration < 10; iteration += 1) {
    const { items, counts } = planImport(parsed, importedTasks, { prefix: 'SI' });
    if (iteration === 0) {
      assert.deepEqual(counts, { add: 1, update: 1, same: 0, skip: 0 });
    } else {
      assert.deepEqual(counts, { add: 0, update: 0, same: 2, skip: 0 });
    }

    for (const item of items) {
      if (item.kind === 'add') {
        importedTasks.push({ ...issueFromRow(item.row, 'Sagar Ingle', 'SI'), id: 'SI-4' });
      } else if (item.kind === 'update') {
        Object.assign(item.task, patchFromChanges(item.changes));
      }
    }
    assert.equal(importedTasks.length, 2);
  }

  assert.equal(importedTasks[0].owner, 'Yash');
  assert.equal(importedTasks[0].due, '2026-05-22');
  assert.equal(importedTasks[1].desc, 'Validate supplier plan');
  assert.equal(importedTasks[1].owner, 'Amit');
});

test('plan: department aliases are compared after normalizing', () => {
  const parsed = { rows: [row({ sr: '1', program: 'KTM_FIX', desc: 'Release drawing', dept: 'PE' })] };
  const { counts } = planImport(parsed, [{ ...tasks[0], dept: 'ENGG' }], { prefix: 'SI', normalizeDept: (d) => (d === 'ENGG' ? 'PE' : d) });
  assert.equal(counts.same, 1);
});

test('Excel export round-trips through the importer with dates intact', () => {
  const { buildXlsx, excelSerial } = require('./xlsx-writer');
  assert.equal(excelSerial('2026-05-12'), MAY_12);
  const bytes = buildXlsx({
    sheetName: 'Issues',
    headers: ['Issue ID', 'Program', 'Description', 'Start Date', 'Target Date', 'Next Date'],
    rows: [['SI-1', 'KTM_FIX', 'Drawing & BOM <rev A>', '2026-05-12', '2026-05-15', '']],
    dateColumns: [3, 4, 5],
  });
  const [sheet] = readWorkbook(bytes, 'x.xlsx');
  assert.equal(sheet.name, 'Issues');
  assert.deepEqual(sheet.rows[1], ['SI-1', 'KTM_FIX', 'Drawing & BOM <rev A>', MAY_12, MAY_12 + 3]);
  const parsed = parseTracker([sheet]);
  assert.equal(parsed.rows[0].id, 'SI-1');
  assert.equal(parsed.rows[0].start, '2026-05-12');
  assert.equal(parsed.rows[0].due, '2026-05-15');
});
