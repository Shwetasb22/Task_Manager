// Reads the cell values of an .xlsx workbook or a .csv file into plain rows, in the browser or in Node.
// Only values are read (no formatting). Formula cells give their last calculated value, as saved by Excel.
const { unzipSync, strFromU8 } = require('fflate');

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeXml(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()];
  });
}

// All <t> texts inside a fragment, joined (covers plain and rich-text strings).
function textOf(fragment) {
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = re.exec(fragment))) out += decodeXml(m[1]);
  return out;
}

function attr(tag, name) {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return m ? decodeXml(m[1]) : null;
}

// "B12" -> 1 (zero-based column index)
function columnIndex(ref) {
  const letters = /^[A-Z]+/.exec(ref || '')?.[0] || 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readSheetXml(xml, sharedStrings) {
  const rows = [];
  const rowRe = /<row\b([^>]*)>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(xml))) {
    const rowNumber = Number(attr(rowMatch[1], 'r')) || rows.length + 1;
    const cells = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[2]))) {
      const tag = cellMatch[1];
      const body = cellMatch[2] || '';
      const ref = attr(tag, 'r');
      const index = ref ? columnIndex(ref) : cells.length;
      const type = attr(tag, 't');
      const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = null;
      if (type === 's') value = raw == null ? null : sharedStrings[Number(raw)] ?? null;
      else if (type === 'inlineStr') value = textOf(body);
      else if (type === 'str' || type === 'e') value = raw == null ? null : decodeXml(raw);
      else if (type === 'b') value = raw === '1';
      else if (raw != null && raw !== '') value = Number(raw);
      cells[index] = value;
    }
    rows[rowNumber - 1] = Array.from(cells, (v) => (v === undefined ? null : v));
  }
  return Array.from(rows, (r) => r || []);
}

function readXlsx(bytes) {
  let files;
  try {
    files = unzipSync(bytes, { filter: (f) => f.name.startsWith('xl/') && f.name.endsWith('.xml') || f.name.endsWith('.rels') });
  } catch {
    throw new Error('This file could not be opened as an Excel workbook (.xlsx).');
  }
  const get = (name) => (files[name] ? strFromU8(files[name]) : null);
  const workbook = get('xl/workbook.xml');
  if (!workbook) throw new Error('This file is not an Excel workbook (.xlsx).');

  const shared = [];
  const sst = get('xl/sharedStrings.xml');
  if (sst) {
    const siRe = /<si>([\s\S]*?)<\/si>/g;
    let m;
    while ((m = siRe.exec(sst))) shared.push(textOf(m[1]));
  }

  const targets = {};
  const rels = get('xl/_rels/workbook.xml.rels') || '';
  const relRe = /<Relationship\b([^>]*)\/?>/g;
  let rel;
  while ((rel = relRe.exec(rels))) {
    const target = attr(rel[1], 'Target') || '';
    targets[attr(rel[1], 'Id')] = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }

  const sheets = [];
  const sheetRe = /<sheet\b([^>]*)\/?>/g;
  let s;
  while ((s = sheetRe.exec(workbook))) {
    const name = attr(s[1], 'name');
    const path = targets[attr(s[1], 'r:id')];
    const xml = path && get(path);
    if (xml) sheets.push({ name, rows: readSheetXml(xml, shared) });
  }
  return sheets;
}

// CSV with ; , or tab separators and quoted fields.
function readCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0];
  const sep = [';', '\t', ','].map((c) => [c, firstLine.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return [{ name: 'CSV', rows: rows.map((r) => r.map((v) => (v.trim() === '' ? null : v))) }];
}

const CP1252 = [...'\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178'];

function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    // CSV saved by older Excel (Windows-1252). Decoded by hand: some runtimes treat it as Latin-1.
    return Array.from(bytes, (b) => (b >= 0x80 && b <= 0x9f ? CP1252[b - 0x80] : String.fromCharCode(b))).join('');
  }
}

// bytes: Uint8Array of the file. Returns [{ name, rows: [[value, ...], ...] }].
function readWorkbook(bytes, fileName = '') {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (isZip) return readXlsx(bytes);
  if (/\.xls$/i.test(fileName) || (bytes[0] === 0xd0 && bytes[1] === 0xcf)) {
    throw new Error('Old .xls files are not supported. In Excel choose File > Save As > Excel Workbook (.xlsx), then upload that.');
  }
  return readCsv(decodeText(bytes));
}

module.exports = { readWorkbook, readCsv, columnIndex };
