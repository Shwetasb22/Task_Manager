'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ownerSegments, suggestEmployees, withSuggestion } from '@/lib/employees';

// Owner field with suggestions from the employee list. Several owners are written "A / B"; the list
// suggests names for the part being typed. Free text still works for someone not on the list yet.
// - onChange(value) on every keystroke (forms); onCommit(value) when the person leaves the field (cells).
export default function OwnerPicker({ value, employees = [], onChange, onCommit, className = '', placeholder = 'Type a name…', autoFocus = false, ariaLabel = 'Owner', inputRef, disabled = false }) {
  const shown = value ?? '';
  const [text, setText] = useState(shown);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [box, setBox] = useState(null);
  const ref = useRef(null);
  const listId = useId();
  const lastShown = useRef(shown);

  // A new value from outside (for example a teammate's live edit) replaces the text when not editing.
  useEffect(() => {
    if (shown !== lastShown.current && document.activeElement !== ref.current) setText(shown);
    lastShown.current = shown;
  }, [shown]);

  const { current } = ownerSegments(text);
  const suggestions = useMemo(() => {
    const parts = ownerSegments(text);
    return suggestEmployees(employees, parts.current, parts.done);
  }, [employees, text]);
  const groupedSuggestions = useMemo(() => {
    const groups = new Map();
    suggestions.forEach((employee) => {
      const department = employee.department || 'Other';
      groups.set(department, [...(groups.get(department) || []), employee]);
    });
    return [...groups.entries()];
  }, [suggestions]);

  function place() {
    const r = ref.current?.getBoundingClientRect();
    if (r) setBox({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 240) });
  }
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!e.target?.closest?.('[data-owner-list]')) setOpen(false); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [open]);

  const update = (next) => { setText(next); onChange?.(next); };
  function pick(emp) {
    update(withSuggestion(text, emp.name));
    setOpen(false);
    setActive(0);
  }
  function commit() {
    setOpen(false);
    if (onCommit && text.trim() !== shown.trim()) onCommit(text.trim());
  }

  return (
    <>
      <input
        ref={(el) => { ref.current = el; if (inputRef) inputRef.current = el; }}
        value={text}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={ariaLabel}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={Boolean(open && suggestions.length > 0)}
        aria-controls={listId}
        autoComplete="off"
        disabled={disabled}
        title="Pick from the employee list, or type a name. Separate several owners with /"
        className={className}
        onFocus={() => { if (!disabled) { place(); setOpen(true); } }}
        onChange={(e) => { update(e.target.value); place(); setOpen(true); setActive(0); }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && suggestions.length) { e.preventDefault(); setOpen(true); setActive((a) => (a + 1) % suggestions.length); }
          else if (e.key === 'ArrowUp' && suggestions.length) { e.preventDefault(); setActive((a) => (a - 1 + suggestions.length) % suggestions.length); }
          else if (e.key === 'Enter') {
            e.preventDefault();
            if (open && suggestions.length && current.trim()) pick(suggestions[active] || suggestions[0]);
            else e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); } // keeps the surrounding form open else if (onCommit) { setText(shown); e.currentTarget.blur(); }
          }
        }}
      />
      {open && box && suggestions.length > 0 && (
        <ul
          data-owner-list
          id={listId}
          role="listbox"
          aria-label="Employees"
          style={{ position: 'fixed', top: box.top, left: box.left, width: box.width }}
          className="z-[60] max-h-64 overflow-auto bg-white border border-brembo-line rounded-md shadow-defined py-1 text-[12px]"
        >
          {groupedSuggestions.map(([department, group]) => (
            <li key={department} role="presentation">
              <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brembo-sub bg-brembo-panel2">{department}</div>
              <ul role="group" aria-label={department}>
                {group.map((emp) => {
                  const i = suggestions.indexOf(emp);
                  return (
                    <li
                      key={emp.id || emp.name}
                      role="option"
                      aria-selected={i === active}
                      onMouseDown={(e) => { e.preventDefault(); pick(emp); }}
                      onMouseEnter={() => setActive(i)}
                      className={`px-2.5 py-1.5 cursor-pointer flex items-baseline justify-between gap-3 ${i === active ? 'bg-brembo-red/10 text-brembo-ink' : 'text-brembo-ink'}`}
                    >
                      <span className="font-semibold truncate">{emp.name}</span>
                      <span className="text-[10.5px] text-brembo-sub truncate">{emp.email || ''}</span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          <li className="px-2.5 pt-1 pb-0.5 text-[10.5px] text-brembo-sub border-t border-brembo-line mt-1">Type &quot; / &quot; to add another person</li>
        </ul>
      )}
    </>
  );
}
