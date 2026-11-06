// @mentions in issue comments. A mention is "@" followed by a name from the employee list; the comment
// box suggests names while typing and inserts the full name, so mentions are always exact names.

// The "@na" being typed just before the caret, if any: { start, query }. Allows one space ("@Vishal Sh").
function mentionQuery(text, caret) {
  const before = String(text || '').slice(0, caret);
  const m = before.match(/(^|\s)@([\p{L}.'-]*(?: [\p{L}.'-]*)?)$/u);
  if (!m) return null;
  return { start: before.length - m[2].length - 1, query: m[2] };
}

// Replaces the "@na" at start..caret with "@Full Name " and returns the new text and caret position.
function insertMention(text, start, caret, name) {
  const value = String(text || '');
  const inserted = `@${name} `;
  return { text: value.slice(0, start) + inserted + value.slice(caret).replace(/^ /, ''), caret: start + inserted.length };
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Names from the list that are mentioned in the text, longest first so "@Vishal Shinde" is not also "@Vishal".
function findMentions(text, names) {
  let rest = String(text || '');
  const found = [];
  [...new Set((names || []).filter(Boolean))].sort((a, b) => b.length - a.length).forEach((name) => {
    const re = new RegExp(`(^|[^\\p{L}])@${escapeRe(name)}(?![\\p{L}])`, 'iu');
    if (re.test(rest)) {
      found.push(name);
      rest = rest.replace(new RegExp(`@${escapeRe(name)}(?![\\p{L}])`, 'giu'), ' ');
    }
  });
  return found.slice(0, 20);
}

// Splits a comment into text and mention parts for display: [{ text, mention: bool }].
function splitMentions(text, mentions) {
  const value = String(text || '');
  const names = [...(mentions || [])].sort((a, b) => b.length - a.length);
  if (!names.length) return [{ text: value, mention: false }];
  const re = new RegExp(`@(?:${names.map(escapeRe).join('|')})(?![\\p{L}])`, 'giu');
  const parts = [];
  let last = 0;
  value.replace(re, (match, offset) => {
    if (offset > last) parts.push({ text: value.slice(last, offset), mention: false });
    parts.push({ text: match, mention: true });
    last = offset + match.length;
    return match;
  });
  if (last < value.length) parts.push({ text: value.slice(last), mention: false });
  return parts;
}

module.exports = { mentionQuery, insertMention, findMentions, splitMentions };
