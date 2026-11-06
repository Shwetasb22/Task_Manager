'use client';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { History, MessageSquare, Send, X } from 'lucide-react';
import { store } from '@/lib/store';
import { describeEvent } from '@/lib/events';
import { suggestEmployees } from '@/lib/employees';
import { findMentions, insertMention, mentionQuery, splitMentions } from '@/lib/mentions';

// Who changed what on one issue, newest first, from the audit trail, plus comments with @mentions.
// liveKey changes when new events arrive (a teammate's comment), so the list reloads by itself.
export default function IssueHistory({ task, session, employees = [], liveKey, onComment, onEditComment, onClose }) {
  const [events, setEvents] = useState(null);
  const [err, setErr] = useState(null);
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [mention, setMention] = useState(null); // { start, query } while typing "@na"
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const listId = useId();

  useEffect(() => {
    let alive = true;
    store.listTaskHistory(task.id)
      .then((rows) => alive && setEvents(rows))
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [task.id, liveKey]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !e.defaultPrevented && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const names = useMemo(() => employees.filter((e) => e.active !== false).map((e) => e.name), [employees]);
  const suggestions = useMemo(() => (mention ? suggestEmployees(employees, mention.query, [], 6) : []), [employees, mention]);
  const latestCommentEdit = useMemo(() => {
    const latest = new Map();
    for (const event of events || []) {
      if (event.action === 'comment_edited' && event.detail?.comment_id != null && !latest.has(String(event.detail.comment_id))) {
        latest.set(String(event.detail.comment_id), { text: event.detail.to, mentions: event.detail.mentions || [] });
      }
    }
    return latest;
  }, [events]);
  const isOwnComment = (event) => session?.id
    ? event.actor === session.id
    : Boolean(event.actor_name && event.actor_name === (session?.display || session?.name));

  const track = (value, caret) => { setMention(mentionQuery(value, caret)); setActive(0); };
  const pick = (emp) => {
    const el = boxRef.current;
    const next = insertMention(text, mention.start, el ? el.selectionStart : text.length, emp.name);
    pendingCaret.current = next.caret;
    setText(next.text);
    setMention(null);
  };
  // Put the cursor after the inserted name in the same paint as the new text, so letters typed
  // straight after picking a name never land in the wrong place.
  const pendingCaret = useRef(null);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (pendingCaret.current === null || !el) return;
    el.focus();
    el.setSelectionRange(pendingCaret.current, pendingCaret.current);
    pendingCaret.current = null;
  }, [text]);

  async function post() {
    const body = text.trim();
    if (!body || posting) return;
    setPosting(true);
    const ok = await onComment(task, body, findMentions(body, names));
    setPosting(false);
    if (ok) {
      setText('');
      setMention(null);
      store.listTaskHistory(task.id).then(setEvents).catch(() => {});
    }
  }

  async function saveEditedComment(commentId) {
    const body = editingText.trim();
    if (!body || body.length > 2000 || savingEdit) return;
    setSavingEdit(true);
    const ok = await onEditComment(commentId, body, findMentions(body, names));
    setSavingEdit(false);
    if (ok) {
      setEditingCommentId(null);
      setEditingText('');
      store.listTaskHistory(task.id).then(setEvents).catch(() => {});
    }
  }

  function onKeyDown(e) {
    if (mention && suggestions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(suggestions[active]); return; }
    }
    // Escape while typing a name ends the name first; the next Escape closes the window.
    if (e.key === 'Escape' && mention) { e.preventDefault(); e.stopPropagation(); setMention(null); return; }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); post(); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 md:p-8" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="issue-history-title" className="glass-panel rounded-xl w-full max-w-xl max-h-full flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-brembo-line">
          <div className="min-w-0">
            <h2 id="issue-history-title" className="font-semibold text-[14px] flex items-center gap-2"><History size={15} /> History and comments of {task.id}</h2>
            <div className="text-[11px] text-brembo-sub truncate">{task.program} · {task.owner}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close history" className="bg-brembo-panel2 border border-brembo-line rounded-full p-1.5"><X size={15} /></button>
        </div>
        <div className="overflow-auto p-4 text-[12.5px] flex-1">
          {err && <div className="text-[#9b1224]">Could not load the history: {err}</div>}
          {!err && !events && <div className="text-brembo-sub">Loading…</div>}
          {!err && events && events.length === 0 && <div className="text-brembo-sub">No changes or comments yet. Changes made in the app from now on appear here.</div>}
          {!err && events && events.length > 0 && (
            <ol className="space-y-3" aria-label="History">
              {events.map((event) => {
                if (event.action === 'comment') {
                  const commentId = String(event.detail?.comment_id ?? '');
                  const latestEdit = latestCommentEdit.get(commentId);
                  const shownText = latestEdit?.text ?? event.detail?.text ?? '';
                  const shownMentions = latestEdit?.mentions ?? event.detail?.mentions;
                  const editing = editingCommentId === commentId;
                  const edited = latestCommentEdit.has(commentId) || event.detail?.edited;
                  return (
                    <li key={event.id} className="rounded-lg border border-brembo-line bg-white px-3 py-2" data-comment>
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] text-brembo-sub flex items-center gap-1.5"><MessageSquare size={11} /> <b className="text-brembo-ink">{event.actor_name || 'Someone'}</b> · {new Date(event.at).toLocaleString()}{edited && <span className="italic">· edited</span>}</div>
                        {onEditComment && isOwnComment(event) && !editing && <button type="button" onClick={() => { setEditingCommentId(commentId); setEditingText(shownText); }} className="text-[10.5px] font-semibold text-brembo-red hover:underline">Edit reply</button>}
                      </div>
                      {editing ? (
                        <div className="mt-2">
                          <textarea value={editingText} maxLength={2000} rows={3} onChange={(e) => setEditingText(e.target.value)} aria-label="Edit your reply" className="w-full resize-y bg-white border border-brembo-line rounded-md px-2.5 py-2 text-[12.5px] focus:outline-none focus:border-brembo-red" />
                          <div className="mt-2 flex justify-end gap-2">
                            <button type="button" onClick={() => { setEditingCommentId(null); setEditingText(''); }} className="rounded-full border border-brembo-line px-3 py-1 text-[11px]">Cancel</button>
                            <button type="button" disabled={!editingText.trim() || savingEdit} onClick={() => saveEditedComment(commentId)} className="rounded-full bg-brembo-red text-white px-3 py-1 text-[11px] font-bold disabled:opacity-40">{savingEdit ? 'Saving…' : 'Save reply'}</button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-1 whitespace-pre-wrap break-words text-brembo-ink">
                          {splitMentions(shownText, shownMentions).map((part, i) => (part.mention
                            ? <span key={i} className="font-semibold text-brembo-red">{part.text}</span>
                            : <span key={i}>{part.text}</span>))}
                        </div>
                      )}
                    </li>
                  );
                }
                return (
                  <li key={event.id} className="border-l-2 border-brembo-red/40 pl-3">
                    <div className="text-[11px] text-brembo-sub">{new Date(event.at).toLocaleString()}</div>
                    {describeEvent(event).map((line) => <div key={line} className="text-brembo-ink">{line}</div>)}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        {onComment && (
          <div className="relative border-t border-brembo-line p-3 bg-white">
            {mention && suggestions.length > 0 && (
              <ul id={listId} role="listbox" aria-label="People to mention" className="absolute left-3 right-3 bottom-full mb-1 max-h-56 overflow-auto bg-white border border-brembo-line rounded-md shadow-defined py-1 text-[12px] z-10">
                {suggestions.map((emp, i) => (
                  <li
                    key={emp.id || emp.name}
                    role="option"
                    aria-selected={i === active}
                    onMouseDown={(e) => { e.preventDefault(); pick(emp); }}
                    onMouseEnter={() => setActive(i)}
                    className={`px-2.5 py-1.5 cursor-pointer flex items-baseline justify-between gap-3 ${i === active ? 'bg-brembo-red/10' : ''}`}
                  >
                    <span className="font-semibold truncate">{emp.name}</span>
                    <span className="text-[10.5px] text-brembo-sub truncate">{emp.department || emp.email || ''}</span>
                  </li>
                ))}
              </ul>
            )}
            <textarea
              ref={boxRef}
              value={text}
              rows={2}
              maxLength={2000}
              onChange={(e) => { setText(e.target.value); track(e.target.value, e.target.selectionStart); }}
              onClick={(e) => track(e.target.value, e.target.selectionStart)}
              onKeyDown={onKeyDown}
              onBlur={() => setTimeout(() => { if (document.activeElement !== boxRef.current) setMention(null); }, 150)}
              role="combobox"
              aria-expanded={Boolean(mention && suggestions.length)}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-label="Write a comment"
              placeholder="Write a comment. Type @ to mention someone."
              className="w-full resize-y bg-white border border-brembo-line rounded-md px-2.5 py-2 text-[12.5px] focus:outline-none focus:border-brembo-red"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-[10.5px] text-brembo-sub">People you mention see it in their bell. Ctrl+Enter posts.</span>
              <button type="button" onClick={post} disabled={!text.trim() || posting} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-bold bg-brembo-red text-white disabled:opacity-40">
                <Send size={12} /> {posting ? 'Posting…' : 'Post comment'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
