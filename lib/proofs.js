// Proof-file rules shared by the UI and both stores. The same allow-list and size
// limit are ALSO enforced by the database (bucket file_size_limit + storage policy),
// so bypassing the UI does not bypass the rules. SVG/HTML are deliberately excluded.
import { isOwnerOf } from './owners.js';

export const MAX_BYTES = 10 * 1024 * 1024;

const MIME = {
  pdf: 'application/pdf',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  txt: 'text/plain', csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  msg: 'application/vnd.ms-outlook',
  eml: 'message/rfc822',
};
export const ALLOWED_EXT = Object.keys(MIME);
export const ACCEPT = ALLOWED_EXT.map((e) => `.${e}`).join(',');

export const ext = (name) => {
  const s = String(name || '');
  return s.includes('.') ? s.split('.').pop().toLowerCase() : '';
};
export const mimeFor = (name, fallback) => MIME[ext(name)] || fallback || 'application/octet-stream';

export function createUuid() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  const bytes = new Uint8Array(16);
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256); });
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function validateFile(file) {
  if (!file) return 'No file selected';
  if (!MIME[ext(file.name)]) return `.${ext(file.name) || '?'} files are not allowed (allowed: ${ALLOWED_EXT.join(', ')})`;
  if (file.size === 0) return 'The file is empty';
  if (file.size > MAX_BYTES) return `The file is larger than ${MAX_BYTES / 1048576} MB`;
  return null;
}

// Managers/Admins may remove any proof they can see. Owners may remove only proof they
// uploaded themselves, and only while the issue is still open (migration 0012 enforces
// the same rule in the database).
export function canRemoveProof(session, task, proof) {
  if (!session || !task || !proof) return false;
  if (session.role === 'Manager' || session.role === 'Admin') return true;
  if (!isOwnerOf(session, task) || task.status === 'Closed' || task.closed) return false;
  if (proof.byId) return Boolean(session.id) && proof.byId === session.id;
  const me = session.display || session.name;
  return Boolean(me) && proof.by === me;
}

// How the viewer can show a proof
export function kindFor(proof) {
  const e = ext(proof && proof.name);
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(e)) return 'image';
  if (e === 'pdf') return 'pdf';
  if (['txt', 'csv'].includes(e)) return 'text';
  return 'other';
}

// Storage object keys must be plain ASCII
export const safeName = (name) => String(name).replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120);

export function fmtSize(n) {
  if (n == null) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
