import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// lib/export.js uses bundler-style extensionless imports.
registerHooks({
  resolve(specifier, context, next) {
    try { return next(specifier, context); } catch (error) {
      if (specifier.startsWith('.') && !/\.\w+$/.test(specifier)) return next(`${specifier}.js`, context);
      throw error;
    }
  },
});

const { formatError, databaseError } = await import('./errors.js');
const { normalizeDepartment } = await import('./departments.js');
const { taskExportRows, TASK_EXPORT_HEADERS, TASK_EXPORT_DATE_COLUMNS, TASK_EXPORT_WRAP_COLUMNS } = await import('./export.js');

test('errors read well and keep their database code', () => {
  assert.equal(formatError(new Error('Boom')), 'Boom');
  assert.equal(formatError({ message: 'Denied', code: '42501', details: 'RLS' }), 'Denied · Code: 42501 · Details: RLS');
  assert.equal(formatError(null), 'The request failed.');
  const e = databaseError({ message: 'x', code: '23514' });
  assert.ok(e instanceof Error);
  assert.equal(e.code, '23514');
  assert.equal(databaseError(undefined).message, 'The database request failed.');
});

test('department spellings are standardised', () => {
  assert.equal(normalizeDepartment('PM-BI'), 'PRGM');
  assert.equal(normalizeDepartment(' process '), 'PRCE');
  assert.equal(normalizeDepartment('finance'), 'CE');
  assert.equal(normalizeDepartment('QE'), 'QE');
  assert.equal(normalizeDepartment(''), 'Unassigned');
  assert.equal(normalizeDepartment(null), 'Unassigned');
});

test('export rows line up with the export headers', () => {
  const [row] = taskExportRows([{
    id: 'SI-1', customer: 'KTM', manager: 'Sagar Ingle', program: 'P', desc: 'D', dept: 'PRGM', owner: 'O',
    start: '2026-01-01', due: '2026-01-11', next: null, closed: null, status: 'Open', rgy: 'Yellow', sev: 'Normal',
    esc: 'Neutral', proofs: [{ name: 'a.pdf' }, { name: 'b.pdf' }], remark: 'R',
  }]);
  assert.equal(row.length, TASK_EXPORT_HEADERS.length);
  assert.equal(row[TASK_EXPORT_HEADERS.indexOf('Days Pending')], 10);
  assert.equal(row[TASK_EXPORT_HEADERS.indexOf('Document Proof')], 'a.pdf; b.pdf');
  assert.deepEqual(TASK_EXPORT_DATE_COLUMNS.map((i) => TASK_EXPORT_HEADERS[i]), ['Start Date', 'Target Date', 'Next Date', 'Actual Close Date']);
  assert.deepEqual(TASK_EXPORT_WRAP_COLUMNS.map((i) => TASK_EXPORT_HEADERS[i]), ['Description', 'Remarks']);
  assert.equal(taskExportRows([{ id: 'X' }])[0][11], '', 'missing dates give an empty Days Pending');
});
