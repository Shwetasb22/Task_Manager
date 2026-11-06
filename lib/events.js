// Audit-trail helpers shared by the notification bell and the issue history panel.
// Events come from public.task_events (production) or the demo log in lib/store/local.js:
//   { id, task_id, actor, actor_name, action: 'created'|'update'|'proof_added'|'proof_removed'|'comment', detail, at }
// For 'update', detail is { column: { from, to } } using database column names.
// For 'comment', detail is { comment_id, text, mentions: [name] } (from public.task_comments).

const FIELD_LABELS = {
  program: 'Program', description: 'Description', dept: 'Department', customer: 'Customer', owner: 'Owner',
  member: 'Member', start_date: 'Start date', due_date: 'Target date', next_date: 'Next date',
  closed_date: 'Close date', remark: 'Remark', manager: 'Tracker',
};
const { isOwnerOf, normName } = require('./owners');
const isMine = (session, owner) => isOwnerOf(session, { owner });

const HIDDEN_FIELDS = new Set(['member', 'custom', 'created_at']);

const show = (value) => (value === null || value === undefined || value === '' ? '—' : String(value));

function describeChange(field, change) {
  const label = FIELD_LABELS[field] || field;
  if (field === 'closed_date') return change?.to ? `closed the issue (${change.to})` : 'reopened the issue and sent it back to the owner';
  if (field === 'remark') return change?.to ? `set remark: "${change.to}"` : 'cleared the remark';
  return `changed ${label} from ${show(change?.from)} to ${show(change?.to)}`;
}

/**
 * Plain-language lines for one event, e.g. ["Sagar Ingle changed Target date from 2026-10-01 to 2026-10-05"].
 * @returns {string[]}
 */
function describeEvent(event) {
  const who = event.actor_name || 'Someone';
  const detail = event.detail || {};
  if (event.action === 'created') return [`${who} added the issue${detail.owner ? ` for ${detail.owner}` : ''}`];
  if (event.action === 'proof_added') return [`${who} uploaded proof ${detail.filename || ''}`.trim()];
  if (event.action === 'proof_removed') return [`${who} removed proof ${detail.filename || ''}`.trim()];
  if (event.action === 'comment') return [`${who} commented: "${detail.text || ''}"`];
  if (event.action === 'comment_edited') return [`${who} edited a reply.`];
  if (event.action === 'update') {
    const lines = Object.entries(detail)
      .filter(([field]) => !HIDDEN_FIELDS.has(field))
      .map(([field, change]) => `${who} ${describeChange(field, change)}`);
    return lines.length ? lines : [`${who} updated the issue`];
  }
  return [`${who} ${event.action}`];
}

// True when a comment mentions this person (by their name, display name or a known spelling).
const mentionsMe = (session, mentions) => {
  const mine = new Set([session?.name, session?.display, ...(session?.aliases || [])].filter(Boolean).map(normName));
  return (mentions || []).some((name) => mine.has(normName(name)));
};
const short = (text) => (String(text || '').length > 120 ? `${String(text).slice(0, 118)}…` : String(text || ''));

const isByMe = (event, session) => Boolean(
  (event.actor && session?.id && event.actor === session.id)
  || (!event.actor && event.actor_name && event.actor_name === (session?.display || session?.name)),
);

/**
 * Notifications that need someone's attention, newest first.
 * Managers/Admins: issues closed by someone else (to review) and proof uploads.
 * Owners: issues sent back (reopened), remarks from others, and issues newly assigned to them.
 * Everyone: comments that @mention them. Owners and managers: comments by others on their issues.
 * @param {object[]} events task_events rows the user can see
 * @param {object[]} tasks tasks in the user's current view (derived)
 * @param {object} session
 * @returns {{ id: string, kind: string, taskId: string, at: string, text: string }[]}
 */
function buildNotifications(events, tasks, session) {
  if (!session) return [];
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const isManager = session.role === 'Manager' || session.role === 'Admin';
  const out = [];
  for (const event of events) {
    const task = byId.get(event.task_id);
    if (!task || isByMe(event, session)) continue;
    const who = event.actor_name || 'Someone';
    const detail = event.detail || {};
    const base = { id: String(event.id), taskId: task.id, at: event.at, program: task.program };
    if (event.action === 'comment') {
      if (mentionsMe(session, detail.mentions)) out.push({ ...base, kind: 'mention', text: `${who} mentioned you: "${short(detail.text)}"` });
      else if (session.role !== 'Admin') out.push({ ...base, kind: 'comment', text: `${who} commented: "${short(detail.text)}"` });
      continue;
    }
    if (isManager) {
      if (event.action === 'update' && detail.remark?.to) {
        out.push({ ...base, kind: 'remark', text: `${who} added a remark for the manager: "${short(detail.remark.to)}"` });
      } else if (event.action === 'update' && detail.closed_date?.to && task.status === 'Closed') {
        out.push({ ...base, kind: 'review', text: `${who} closed this issue. Review the proof, or reopen it to send it back.` });
      } else if (event.action === 'proof_added') {
        out.push({ ...base, kind: 'proof', text: `${who} uploaded ${detail.filename || 'proof'}` });
      }
    } else if (session.role === 'Owner') {
      if (event.action === 'created' && isMine(session, detail.owner)) {
        out.push({ ...base, kind: 'assigned', text: `${who} assigned this issue to you.` });
        continue;
      }
      if (event.action !== 'update') continue;
      const parts = [];
      let kind = 'update';
      if (detail.closed_date && detail.closed_date.from && !detail.closed_date.to) { parts.push('reopened this issue and sent it back to you'); kind = 'sent-back'; }
      if (isMine(session, detail.owner?.to)) { parts.push('assigned this issue to you'); kind = kind === 'update' ? 'assigned' : kind; }
      if (detail.remark?.to) { parts.push(`added a remark: "${detail.remark.to}"`); kind = kind === 'update' ? 'remark' : kind; }
      if (detail.due_date) { parts.push(`changed the target date to ${show(detail.due_date.to)}`); kind = kind === 'update' ? 'date' : kind; }
      if (parts.length) out.push({ ...base, kind, text: `${who} ${parts.join(', and ')}.` });
    }
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

module.exports = { describeEvent, buildNotifications, FIELD_LABELS };
