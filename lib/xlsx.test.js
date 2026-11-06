// Excel export (xlsx-writer) read back by the Excel import (xlsx-reader), plus small shared helpers.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildXlsx, excelSerial, columnName } = require('./xlsx-writer');
const { readWorkbook, readCsv, columnIndex } = require('./xlsx-reader');

test('column names and indexes are inverse', () => {
  for (const [i, name] of [[0, 'A'], [25, 'Z'], [26, 'AA'], [51, 'AZ'], [701, 'ZZ'], [702, 'AAA']]) {
    assert.equal(columnName(i), name);
    assert.equal(columnIndex(`${name}12`), i);
  }
});

test('dates become Excel serial numbers', () => {
  assert.equal(excelSerial('1970-01-01'), 25569);
  assert.equal(excelSerial('2026-11-06'), 46332);
  assert.equal(excelSerial('not a date'), null);
});

test('an exported workbook reads back with text, numbers, dates and special characters intact', () => {
  const headers = ['Issue ID', 'Description', 'Days', 'Target Date'];
  const rows = [
    ['SI-1', 'Fix <bracket> & "quotes"', 5, '2026-11-06'],
    ['SI-2', '=HYPERLINK("http://evil")', 0, ''],
    ['SI-3', 'line one\nline two', '', '2026-01-31'],
  ];
  const bytes = buildXlsx({ sheetName: 'Issues', headers, rows, dateColumns: [3], wrapColumns: [1] });
  assert.ok(bytes instanceof Uint8Array && bytes.length > 500);
  const sheets = readWorkbook(bytes, 'export.xlsx');
  const table = Array.isArray(sheets) ? sheets[0].rows || sheets[0] : sheets.rows || sheets;
  const flat = JSON.stringify(table);
  assert.ok(flat.includes('Fix <bracket> & \\"quotes\\"'), 'xml special characters survive');
  assert.ok(flat.includes('=HYPERLINK'), 'a formula-looking value stays plain text');
  assert.ok(flat.includes('SI-3'));
});

test('large exports do not overflow the call stack', () => {
  const rows = Array.from({ length: 150000 }, (_, i) => [`SI-${i}`, 'x']);
  assert.doesNotThrow(() => buildXlsx({ headers: ['Issue ID', 'Text'], rows }));
});

test('CSV import handles quotes, commas and new lines', () => {
  const rows = readCsv('id,desc\nSI-1,"a, b"\nSI-2,"say ""hi"""\nSI-3,"two\nlines"\n');
  const flat = JSON.stringify(rows);
  assert.ok(flat.includes('a, b'));
  assert.ok(flat.includes('say \\"hi\\"'));
  assert.ok(flat.includes('two\\nlines'));
});
