'use client';
// Shared RYGB styling (see lib/rules.js for the rule). Every row tint, pill and card on every page
// uses these classes, so a colour always means the same thing.
import { RYGB, RYGB_ORDER, rygbOf } from '@/lib/rules';

export const RYGB_ROW = {
  Red: 'bg-[#fff0f0]',
  Yellow: 'bg-[#fff9e3]',
  Green: 'bg-[#edf8ef]',
  Blue: 'bg-[#eaf3fb]',
  Grey: 'bg-[#f3f2f3]',
};

export const RYGB_PILL = {
  Red: 'bg-[#fde7ea] text-[#9b1224]',
  Yellow: 'bg-[#fff4d6] text-[#7a5a00]',
  Green: 'bg-[#e3f6ea] text-[#146b38]',
  Blue: 'bg-[#eaf3fc] text-[#1f5f99]',
  Grey: 'bg-[#ececee] text-[#4d4d55]',
};

export const RYGB_SOLID = {
  Red: 'bg-[#C8102E] text-white',
  Yellow: 'bg-[#E0A800] text-[#241a00]',
  Green: 'bg-[#2E9E5B] text-white',
  Blue: 'bg-[#5B9BD5] text-[#0b2a4a]',
  Grey: 'bg-[#8B8588] text-white',
};

export const rowTone = (task) => RYGB_ROW[rygbOf(task)];

// A small coloured status label. `tone` may be a RYGB key or a task.
export function RygbPill({ tone, task, children, className = '' }) {
  const key = RYGB[tone] ? tone : rygbOf(task);
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold inline-block whitespace-nowrap ${RYGB_PILL[key]} ${className}`}>
      {children ?? RYGB[key].label}
    </span>
  );
}

// Colour key shown on pages, so people can read the colours without guessing.
export function RygbLegend({ className = '' }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-brembo-sub ${className}`} aria-label="Colour key">
      {RYGB_ORDER.map((key) => (
        <span key={key} className="inline-flex items-center gap-1.5" title={RYGB[key].rule}>
          <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: RYGB[key].color }} aria-hidden="true" />
          <b className="text-brembo-ink">{RYGB[key].label}</b> · {RYGB[key].rule}
        </span>
      ))}
    </div>
  );
}
