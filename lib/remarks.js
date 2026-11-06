// Remarks exchanged between a Platform Manager and the issue's owner(s) from the Edit issue window.
// A remark is stored as an issue comment that @mentions the other side, so it is kept in the audit
// trail (task_comments → task_events) and appears as "mentioned you" in the recipient's bell.
const { isOwnerOf } = require('./owners');

const MANAGER_SIDE = new Set(['Manager', 'Dept Head', 'Admin']);
const MAX_REMARK = 1500;

// Owner cell "Anjali Iyer / Amit Jadhav" → ['Anjali Iyer', 'Amit Jadhav'] (original spelling kept).
function ownerNames(owner) {
  return [...new Set(String(owner ?? '').split(/\s*[/,&;+]\s*/).map((n) => n.trim()).filter((n) => n && n !== 'Unassigned'))];
}

// Who a remark from this person goes to: managers write to the owner(s), owners write to the manager.
// Returns { side: 'owner' | 'manager' | null, names: string[] }.
function remarkRecipients(task, session) {
  if (!task || !session) return { side: null, names: [] };
  if (MANAGER_SIDE.has(session.role)) return { side: 'owner', names: ownerNames(task.owner) };
  if (session.role === 'Owner' && isOwnerOf(session, task)) {
    return { side: 'manager', names: task.manager ? [task.manager] : [] };
  }
  return { side: null, names: [] };
}

// Comment body and mention list for a remark. Throws a readable error when it cannot be sent.
function buildRemark(task, session, text, { reopened = false } = {}) {
  const body = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!body) throw new Error('Write a remark first.');
  if (body.length > MAX_REMARK) throw new Error(`Keep the remark under ${MAX_REMARK} characters.`);
  const { side, names } = remarkRecipients(task, session);
  if (!side) throw new Error('Only the tracker manager or the assigned owner can send remarks on this issue.');
  if (!names.length) throw new Error(side === 'owner' ? 'This issue has no owner to send the remark to.' : 'This issue has no manager to send the remark to.');
  const prefix = reopened ? 'Reopened — proof not accepted. ' : '';
  return { text: `${names.map((n) => `@${n}`).join(' ')} ${prefix}${body}`, mentions: names.slice(0, 20), side };
}

// Comment events of one issue that are remarks between the two sides, oldest first.
// History arrives newest-first; reversing before the (stable) sort keeps remarks with the
// same timestamp in the order they were written.
function remarkThread(events) {
  return [...(events || [])].reverse()
    .filter((event) => event.action === 'comment' && event.detail?.text)
    .map((event) => ({ id: String(event.id), by: event.actor_name || 'Someone', at: event.at, text: event.detail.text, mentions: event.detail.mentions || [] }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

module.exports = { ownerNames, remarkRecipients, buildRemark, remarkThread, MAX_REMARK };
