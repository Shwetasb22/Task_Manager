import { buildXlsx } from './xlsx-writer';

// Excel workbook with real date cells and sized columns (dates in a CSV often show as ###### in Excel).
export function downloadXlsx(filename, headers, rows, { sheetName, dateColumns, wrapColumns } = {}) {
  const bytes = buildXlsx({ sheetName, headers, rows, dateColumns, wrapColumns });
  saveBlob(filename, new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

function saveBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function taskExportRows(tasks) {
  return tasks.map((t) => [
    t.id, t.customer || '', t.manager || '', t.program || '', t.desc || '', t.dept || '',
    t.owner || '', t.start || '', t.due || '', t.next || '', t.closed || '',
    getDaysPending(t.start, t.due), t.status || '', t.rgy || '', t.sev || '',
    t.esc || '', (t.proofs || []).map((proof) => proof.name).join('; '), t.remark || '',
  ]);
}

export const TASK_EXPORT_HEADERS = [
  'Issue ID', 'Customer', 'Manager', 'Program', 'Description', 'Department', 'Owner',
  'Start Date', 'Target Date', 'Next Date', 'Actual Close Date', 'Days Pending', 'Status',
  'RGY', 'Severity', 'Escalation Level', 'Document Proof', 'Remarks',
];

// Column positions in TASK_EXPORT_HEADERS that hold dates or long text.
export const TASK_EXPORT_DATE_COLUMNS = [7, 8, 9, 10];
export const TASK_EXPORT_WRAP_COLUMNS = [4, 17];

function getDaysPending(start, due) {
  if (!start || !due) return '';
  const startTime = Date.parse(`${start}T00:00:00`);
  const dueTime = Date.parse(`${due}T00:00:00`);
  if (!Number.isFinite(startTime) || !Number.isFinite(dueTime)) return '';
  return Math.round((dueTime - startTime) / 86400000);
}