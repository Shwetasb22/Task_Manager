'use client';
// Standard Operating Procedure for the Program Command issue tracker.
// Limits, colours, escalation levels and file rules are read from the same code the system enforces
// (lib/rules.js, lib/proofs.js), so this document cannot drift from how the system behaves.
import { BookOpenCheck, Printer } from 'lucide-react';
import { DUE_SOON_DAYS, ESCALATION_STAGES, RYGB, RYGB_ORDER } from '@/lib/rules';
import { ALLOWED_EXT, MAX_BYTES } from '@/lib/proofs';

const REVISION = { number: 'SOP-OPL-001', rev: '1.0', effective: '2026-11-06', owner: 'Admin (Program Command)' };
const MAX_MB = MAX_BYTES / (1024 * 1024);

const ROLES = [
  ['Admin', 'Owns this SOP and the system. Sees every tracker; can inspect any manager or person (Team view); can delete any issue; manages the Lists page (trackers and departments) and people.'],
  ['Dept Head', 'Sees every tracker. Receives L3 escalations for their department. Maintains the employee list and is allowed to correct owner names.'],
  ['Platform Manager', 'Runs one tracker. The only role that can create or import issues, and only in their own tracker. Sets target dates, reviews proof, closes, reopens and deletes issues in their tracker. Receives L2 escalations.'],
  ['Owner', 'Person assigned to an issue. Sees only issues assigned to them. Accepts or rejects the target date, uploads proof, closes the issue after uploading proof, and exchanges remarks with the manager. Receives L1 escalations. Cannot create, delete or reopen issues.'],
];

// [action, Admin, Dept Head, Manager, Owner]
const MATRIX = [
  ['View issues', 'All', 'All', 'Own tracker', 'Assigned only'],
  ['Create / import issues', '—', '—', 'Own tracker', '—'],
  ['Edit open issue details', 'Yes', 'Yes', 'Own tracker', 'Assigned (not target date)'],
  ['Change target date', 'Yes', '—', 'Own tracker', '—'],
  ['Accept / reject target date', '—', '—', '—', 'Yes'],
  ['Upload proof', 'Yes', 'Yes', 'Own tracker (open issues)', 'Assigned'],
  ['Close issue (proof required)', 'Yes', '—', 'Own tracker', 'Assigned'],
  ['Reopen closed issue (remark required)', 'Yes', '—', 'Own tracker', '—'],
  ['Edit closed issue', 'Remark only', 'Remark only', 'Remark only', 'Details, proof, remark'],
  ['Delete issue (permanent)', 'Any', '—', 'Own tracker', '—'],
  ['Move issue to another tracker', 'Yes', '—', '—', '—'],
  ['Manage people list', 'Yes (remove)', 'Yes', 'Yes (add/edit)', '—'],
  ['Manage trackers & departments', 'Yes', '—', '—', '—'],
];

const SECTIONS = [
  ['purpose', '1. Purpose'],
  ['scope', '2. Scope'],
  ['definitions', '3. Definitions'],
  ['roles', '4. Roles and responsibilities'],
  ['access', '5. Access and sign-in'],
  ['lifecycle', '6. Issue lifecycle procedure'],
  ['colours', '7. Status colour rules (RYGB)'],
  ['escalation', '8. Escalation matrix'],
  ['proof', '9. Proof of completion'],
  ['communication', '10. Remarks and notifications'],
  ['daily', '11. Daily and weekly routine'],
  ['rules', '12. Rules and regulations'],
  ['records', '13. Records, audit and retention'],
  ['security', '14. Data security and confidentiality'],
  ['revision', '15. Revision history'],
];

function Section({ id, title, children }) {
  return (
    <section id={id} className="scroll-mt-4 border-t border-brembo-line pt-5 mt-5 break-inside-avoid-page">
      <h2 className="font-display text-lg font-bold text-brembo-ink mb-2">{title}</h2>
      <div className="space-y-2 text-[13px] leading-6 text-brembo-ink">{children}</div>
    </section>
  );
}

function Steps({ items }) {
  return (
    <ol className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brembo-red text-[10px] font-bold text-white">{i + 1}</span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

const Bullets = ({ items }) => <ul className="list-disc space-y-1 pl-5">{items.map((item, i) => <li key={i}>{item}</li>)}</ul>;

function Table({ head, rows }) {
  return (
    <div className="table-scroll overflow-x-auto rounded-lg border border-brembo-line">
      <table className="w-full min-w-[640px] text-[12px] border-collapse">
        <thead className="bg-brembo-panel2 text-brembo-sub"><tr>{head.map((h) => <th key={h} className="px-2.5 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
        <tbody>{rows.map((row, r) => <tr key={r} className="border-t border-brembo-line align-top">{row.map((cell, c) => <td key={c} className={`px-2.5 py-2 ${c === 0 ? 'font-semibold whitespace-nowrap' : ''}`}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default function Sop() {
  return (
    <div className="animate-rise-in max-w-[1100px] mx-auto">
      <div className="glass-panel rounded-2xl p-5 md:p-7">
        <header className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-brembo-red text-[11px] uppercase tracking-[.18em] font-bold mb-2"><BookOpenCheck size={14} /> Standard Operating Procedure</div>
            <h1 className="font-display text-3xl font-bold mb-1">Program Issue Tracking — SOP</h1>
            <p className="text-brembo-sub text-[13px]">How program issues are raised, tracked, escalated, evidenced and closed in the Brembo India Program Command system.</p>
          </div>
          <button type="button" onClick={() => window.print()} className="print:hidden inline-flex items-center gap-1.5 self-start rounded-full bg-brembo-red px-4 py-2 text-xs font-bold text-white hover:bg-[#ff3d56]">
            <Printer size={14} /> Print / Save as PDF
          </button>
        </header>

        <dl className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2 text-[12px]">
          {[['Document no.', REVISION.number], ['Revision', REVISION.rev], ['Effective date', REVISION.effective], ['Process owner', REVISION.owner]].map(([k, v]) => (
            <div key={k} className="rounded-lg border border-brembo-line bg-white px-3 py-2"><dt className="text-brembo-sub">{k}</dt><dd className="font-semibold text-brembo-ink">{v}</dd></div>
          ))}
        </dl>

        <nav aria-label="SOP contents" className="print:hidden mt-5 rounded-lg border border-brembo-line bg-white p-3">
          <div className="text-[11px] uppercase tracking-wide text-brembo-sub font-bold mb-1.5">Contents</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1 text-[12.5px]">
            {SECTIONS.map(([id, title]) => <a key={id} href={`#${id}`} className="text-brembo-ink hover:text-brembo-red">{title}</a>)}
          </div>
        </nav>

        <Section id="purpose" title="1. Purpose">
          <p>To define one standard way for every team to record program issues, agree target dates, follow up, escalate, prove completion and close issues, so that status is visible, comparable and auditable across all trackers.</p>
        </Section>

        <Section id="scope" title="2. Scope">
          <p>Applies to every program issue (open action) recorded in the Program Command system by Brembo India program teams, and to everyone with an account: Admins, Department Heads, Platform Managers and Owners. Spreadsheets, e-mails or chat messages are not a substitute for the record in the system.</p>
        </Section>

        <Section id="definitions" title="3. Definitions">
          <Table head={['Term', 'Meaning']} rows={[
            ['Issue', 'One action to be completed, with a program, description, department, owner and target date. Each issue has a permanent ID (e.g. SI-205) that is never reused, even after deletion.'],
            ['Tracker', 'The set of issues belonging to one Platform Manager.'],
            ['Target date', 'Committed completion date. Required on every issue.'],
            ['Next (revised) date', `Optional revised date. It may be at most 7 days after the target date.`],
            ['Proof', 'Evidence file attached to an issue that shows the action is complete.'],
            ['RYGB', 'The five status colours: Red, Yellow, Green, Blue, Grey (section 7).'],
            ['Escalation level', 'L1 / L2 / L3: who must act on an issue, based on its dates (section 8).'],
            ['Remark', 'A note on the issue. A remark sent to the other side (manager ⇄ owner) is delivered to their notification bell.'],
            ['Red flag', 'A manual marker raised on an open issue that needs special attention. The system-wide count is shown on the Dashboard.'],
          ]} />
        </Section>

        <Section id="roles" title="4. Roles and responsibilities">
          <Table head={['Role', 'Responsibility']} rows={ROLES} />
          <p className="font-semibold mt-3">Permission matrix (enforced by the database, not only the screens)</p>
          <Table head={['Action', 'Admin', 'Dept Head', 'Platform Manager', 'Owner']} rows={MATRIX} />
        </Section>

        <Section id="access" title="5. Access and sign-in">
          <Bullets items={[
            'Sign in with your Brembo Outlook ID and password. Everyone signs up with an @bremboindia.com address and chooses Owner or Manager; passwords must be at least 8 characters.',
            'An Owner is let in straight away and sees only issues assigned to their name. A Manager request waits on a "Waiting for approval" screen until an Admin approves it (People page, Access requests) and names the manager’s tracker.',
            'Admin and Dept Head roles cannot be requested at sign-up; they are assigned only by an Admin.',
            'Use "Forgot password" to reset a password. Never share an account or a password.',
            'Log out on shared computers. Logging out removes the copy of issues kept in that browser.',
          ]} />
        </Section>

        <Section id="lifecycle" title="6. Issue lifecycle procedure">
          <p className="font-semibold">6.1 Raise an issue (Platform Manager)</p>
          <Steps items={[
            'Task Register → Add issue (or Import from Excel for an existing tracker sheet; the import shows a preview before saving).',
            'Fill in Program, Issue description (max 1000 characters), Department, Owner (pick from the employee list; separate several owners with " / "), Start date and Target date. Customer, Initial Manager and Resource name are optional.',
            'The target date cannot be earlier than the start date. The issue ID is assigned automatically.',
            'Optionally attach proof or a remark, then select Add issue. The owner is notified.',
          ]} />
          <p className="font-semibold mt-3">6.2 Agree the target date (Owner)</p>
          <Steps items={[
            'In the Task Register, Accept or Reject the proposed target date within 3 days.',
            'If there is no response within 3 days, the target date is accepted automatically.',
            'Owners cannot change the target date. If the date is not achievable, Reject it and give the reason in a remark; the manager sets a new date, which starts a new 3-day response window.',
          ]} />
          <p className="font-semibold mt-3">6.3 Work and update</p>
          <Bullets items={[
            'Keep the Remarks current. Details stay editable until the issue is closed; the issue ID and tracker are locked, and required fields cannot be cleared.',
            'A revised (next) date may be set up to 7 days after the target date. Setting it does not close the issue.',
            'Raise a red flag on an open issue that needs management attention.',
          ]} />
          <p className="font-semibold mt-3">6.4 Close (Owner or Manager)</p>
          <Steps items={[
            'Open the issue (pencil icon) → Upload Proof → "Upload & close" (owner) or "Save, upload & close" (manager).',
            'An issue cannot be closed without at least one proof file. Closing records today as the close date.',
            'Closed issues move to the Closed Issues view and are shown in Blue.',
          ]} />
          <p className="font-semibold mt-3">6.5 Review and reopen (Manager)</p>
          <Steps items={[
            'Review the proof of every issue closed in your tracker (Closed Issues → open the issue → select the proof file).',
            'If the proof is valid, no action is needed.',
            'If the proof is not valid: write the reason in "Remark to owner" and select "Proof invalid — reopen & send remark". The remark is mandatory; the owner is notified and the issue returns to Open or Overdue according to its dates.',
            'Only managers and admins can reopen. While an issue is closed, the owner may still correct details, add proof and send a remark to the manager; the manager may add a remark or reopen.',
          ]} />
          <p className="font-semibold mt-3">6.6 Delete</p>
          <p>Deletion is permanent, removes the attached proof files, and is allowed only for Admins (any tracker) and Platform Managers (own tracker). Prefer closing or correcting an issue over deleting it.</p>
        </Section>

        <Section id="colours" title="7. Status colour rules (RYGB)">
          <p>Every screen, chart, row and label uses these colours. They are calculated automatically from the dates every day; they cannot be set by hand.</p>
          <div className="table-scroll overflow-x-auto rounded-lg border border-brembo-line">
            <table className="w-full min-w-[560px] text-[12px] border-collapse">
              <thead className="bg-brembo-panel2 text-brembo-sub"><tr>{['Colour', 'Status', 'Rule', 'Expected action'].map((h) => <th key={h} className="px-2.5 py-2 text-left font-semibold">{h}</th>)}</tr></thead>
              <tbody>
                {RYGB_ORDER.map((key) => (
                  <tr key={key} className="border-t border-brembo-line">
                    <td className="px-2.5 py-2"><span className="inline-flex items-center gap-2 font-semibold"><span className="h-3.5 w-3.5 rounded" style={{ backgroundColor: RYGB[key].color }} />{key}</span></td>
                    <td className="px-2.5 py-2 font-semibold">{RYGB[key].label}</td>
                    <td className="px-2.5 py-2">{RYGB[key].rule}</td>
                    <td className="px-2.5 py-2">{{
                      Red: 'Recover now; agree a recovery plan if more than 7 days late.',
                      Yellow: `Confirm readiness; due within ${DUE_SOON_DAYS} days.`,
                      Green: 'Routine follow-up.',
                      Blue: 'Manager reviews the proof; reopen with a remark if not valid.',
                      Grey: 'Manager sets a valid target date.',
                    }[key]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="escalation" title="8. Escalation matrix">
          <Table head={['Level', 'Notified', 'Trigger']} rows={ESCALATION_STAGES.filter((s) => s.level !== 'Neutral').map((s) => [s.level, s.role, s.rule])} />
          <Bullets items={[
            'Escalations are recalculated every day from the dates. Closed issues are never escalated.',
            'L1 goes to the assigned owner, L2 to the tracker\'s Platform Manager, L3 to the Department Head of the issue\'s department. Admins see all escalations.',
            'Each recipient sees a red count on the Morning Update tab, a banner of their escalations, and their escalated rows highlighted in red with "ACTION REQUIRED BY YOU". The notification bell lists them too.',
            'The recipient must act the same working day: update the remark, upload proof, or agree a recovery date.',
          ]} />
        </Section>

        <Section id="proof" title="9. Proof of completion">
          <Bullets items={[
            `Allowed file types: ${ALLOWED_EXT.map((e) => `.${e}`).join(', ')}. Maximum ${MAX_MB} MB per file. Empty files, web pages and scripts are rejected.`,
            'Proof must clearly show that the described action is complete (signed report, approved drawing, e-mail approval, photo, etc.).',
            'Files are kept in private storage and opened through links that expire after 5 minutes; they are never public.',
            'An owner may remove proof they uploaded only while the issue is open. Managers and admins may remove proof; every upload and removal is recorded.',
          ]} />
        </Section>

        <Section id="communication" title="10. Remarks and notifications">
          <Bullets items={[
            'Use the "Remarks between manager and owner" box in the Edit issue window: managers send a remark to the owner(s); owners send a remark to the manager. Each remark is delivered to the other side\'s notification bell.',
            'Use History → comment for wider discussion; type @ to mention a person, who is notified.',
            'Write remarks in plain, factual language: what was done, what is pending, the next date.',
            'The notification bell also shows issues due in the next 5 days, assignments, proof uploads, closures to review and issues sent back.',
          ]} />
        </Section>

        <Section id="daily" title="11. Daily and weekly routine">
          <Table head={['When', 'Who', 'Activity']} rows={[
            ['Every working day', 'Everyone', 'Open Morning Update: act on your escalations (red badge), Overdue (Red) and Due Soon (Yellow) issues.'],
            ['Every working day', 'Platform Manager', 'Review proof of newly closed issues; reopen with a remark if not valid. Answer remarks from owners.'],
            ['Every working day', 'Owner', 'Respond to target dates within 3 days; update remarks; upload proof and close completed issues.'],
            ['Weekly', 'Managers, Dept Heads, Admin', 'Weekly Report: overdue, closed this week, on-time rate and per-person summary. Use the Dashboard to drill into problem areas.'],
            ['As needed', 'Admin', 'Maintain people, trackers and departments; inspect teams through the Team view.'],
          ]} />
        </Section>

        <Section id="rules" title="12. Rules and regulations">
          <Bullets items={[
            'Every issue must have one accountable owner and a target date. Issues without a target date (Grey) must be corrected by the manager the same day.',
            'Only Platform Managers create issues, and only in their own tracker. Owners do not create issues.',
            'An issue is closed only when the action is complete and proof is attached. Closing without real completion is not allowed.',
            'Managers must review proof of closed issues. Rejection is done only by reopening with a written reason.',
            'Target dates are changed only by the manager. A revised date may not be more than 7 days after the target date.',
            'Do not delete issues to hide delays. Deletion is for duplicates or entries made in error.',
            'Keep the owner name exactly as in the employee list so the issue reaches the right person; ask a manager to add missing people on the People page.',
            'Do not upload confidential customer data beyond what is needed as evidence.',
            'All actions are recorded with name and time. Misuse of the system is handled under company policy.',
          ]} />
        </Section>

        <Section id="records" title="13. Records, audit and retention">
          <Bullets items={[
            'Every change (field, date, owner, closure, reopen), proof upload/removal and comment is recorded in the issue History with the person and time. The history cannot be edited from the application.',
            'Issues closed more than one year ago are archived every Sunday night (an Admin can also archive from the Lists page). They leave the daily views but stay in the database and History, and remain available with "Show archived" in the Task Register.',
            'Any view can be exported with Download Excel for meetings and audits.',
          ]} />
        </Section>

        <Section id="security" title="14. Data security and confidentiality">
          <Bullets items={[
            'Access is enforced by the database for every request: each person can read and change only what their role allows (section 4).',
            'Proof files are private; links expire after 5 minutes.',
            'Report suspected unauthorized access or wrong permissions to the Admin immediately.',
          ]} />
        </Section>

        <Section id="revision" title="15. Revision history">
          <Table head={['Revision', 'Date', 'Change', 'Approved by']} rows={[[REVISION.rev, REVISION.effective, 'First issue of the SOP', REVISION.owner]]} />
        </Section>
      </div>
    </div>
  );
}
