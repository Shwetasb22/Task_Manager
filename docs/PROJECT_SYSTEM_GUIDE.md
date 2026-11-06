# Brembo India Program Command: System Guide

## 1. Purpose

Brembo India Program Command is a role-aware issue and evidence management application built around manager-owned operational trackers. It brings tracker rows into one application, derives status and escalation from dates, shows follow-up work, and attaches evidence and audit activity to issues.

The intended operating outcome is a shared, current view of:

- Which issues exist and who owns them.
- Which target dates are approaching or overdue.
- Which manager or role is the next escalation point.
- What evidence has been attached and reviewed.
- What changed, who changed it, and when.

This guide describes the current codebase, not a promise that a production deployment, accounts, operational policy, or notification service is already ready.

## 2. System at a glance

```text
Add issue form
          |
          v
Next.js application ---- date rules ---- Dashboard and work views
          |
          +---- local demo store (this browser only)
          |
          +---- Supabase Auth + Postgres/RLS + private Storage
                                      |
                                      +---- audit events
                                      +---- Realtime refreshes
```

The application has two runtime modes:

- **Demo mode:** uses the bundled task seed, localStorage for task edits/metadata, and IndexedDB for proof files. Data remains in that browser and is not shared with teammates.
- **Supabase mode:** uses Supabase Auth, Postgres tables, row-level security (RLS), private object storage, database triggers, and Realtime subscriptions. This is the intended shared production mode when the environment and database are configured.

The browser uses the Supabase publishable/anon key. The service-role key must not be placed in browser code or `.env.local`.

## 3. Technology and entry points

- Next.js 16.3.8 with React 18.3.1; the project scripts explicitly use Webpack.
- Tailwind CSS for styling, Recharts for dashboard charts, and Lucide icons.
- Supabase JS client for auth, database access, storage, and Realtime.
- Node.js 20.9 or newer is required by the current package configuration.

Key implementation files:

- `app/page.js`: session restore, role scoping, data loading, live refresh, issue actions, and view routing.
- `components/Dashboard.js`: filters, KPIs, charts, overdue list, and KPI-click issue tables.
- `lib/dashboard/aggregations.ts`: reusable dashboard aggregation rules.
- `lib/rules.js`: date parsing, RGY, severity, escalation, risk, and alert derivation.
- `components/TaskRegister.js`: issue register, add/delete controls, edits, and proof actions.
- `components/AddIssueModal.js` and `lib/issues.js`: issue entry, field suggestions, validation, and demo ID generation.
- `components/UploadedProofs.js` and `components/ProofViewer.js`: proof list, preview, download, and removal UI.
- `components/AuthScreen.js`: login, owner onboarding, password reset, and demo access.
- `lib/store/index.js`: chooses local or Supabase storage based on environment variables.
- `lib/store/local.js`: browser-only persistence.
- `lib/store/supabase.js`: shared production persistence and auth operations.
- `supabase/migrations`: schema, access policies, triggers, storage rules, and later features.

## 4. Application views

The current sidebar exposes:

- **Dashboard:** filtered KPIs, a due-date action queue, overall issue status, escalation stages, top overdue issues, and clickable KPI detail tables.
- **Morning Update:** Red and Yellow work items for the daily meeting, owner attention counts, and copyable meeting text.
- **Task Register:** searchable active issue rows; Platform Manager create/import controls; editable owner, target date, and remarks; proof upload, close, and reopen controls.
- **Closed Issues:** a dedicated view for closed issues, kept separate from active work.
- **Uploaded Proofs:** files attached to visible issues, preview/download actions, remarks, and role-dependent proof/status actions.
- **SOP:** the standard operating procedure — roles, rules, issue lifecycle, colour and escalation rules, and records.

An Admin can inspect a manager-scoped dashboard from the Team selector without changing the underlying role. The database remains the access enforcement boundary.

## 5. Dashboard filters and scope

Dashboard data starts with the tasks visible to the signed-in role. Admins can optionally scope that view to one manager. Dashboard filters then apply to:

- Department
- Owner
- Customer
- RGY (Red, Yellow, Green)
- Due range (This Week, This Month, Overdue)

Reset clears these filters and any selected KPI detail table. The displayed task set used for KPI calculations excludes rows whose Program field is blank.

Due filter definitions:

- **This Week:** open issues with 0-7 days to target date.
- **This Month:** open issues with 0-30 days to target date.
- **Overdue:** issues whose derived status is Overdue.
- **All:** no due-range restriction.

Selecting Green in the RGY filter excludes closed issues even though closed issues are represented as Green by the core rules. Closed issues have their own KPI.

## 6. Dashboard KPIs: definitions and caveats

Every KPI is calculated after role scope and selected dashboard filters. Each card shows its count and its share of **Total**. Clicking a KPI toggles an issue table at the end of the dashboard; clicking it again closes that table. The table shows issue, program, free-text description, department, owner, target date, status, RGY, and escalation.

| KPI | Counting rule | Important detail |
| --- | --- | --- |
| Total | Number of filtered task rows with a non-empty Program value | Includes closed issues and issues with a missing target date. |
| Closed | Total-set rows with derived status `Closed` | A recorded closed date drives this status. |
| Red | Open rows with RGY `Red` | Current rules make overdue issues Red. |
| Yellow | Open rows with RGY `Yellow` | Currently due today through three days out. |
| Green | Open rows with RGY `Green` | Closed rows are excluded from the RGY aggregation. |

Percent displayed on each card is `card count / Total * 100`, rounded to the nearest whole percent; it is 0 when Total is 0. Because Data Gap rows are neither Red, Yellow, nor Green in the current rules, the status percentages need not add up to 100%. Do not describe the Red/Yellow/Green set as a complete partition of all issues.

## 7. Dashboard visuals

### Due-date action queue

The primary work-prioritization visual groups visible, open tasks by target-date window. It is intentionally based on dates/status only, not Department or Description.

| Queue band | Count rule | Suggested next action |
| --- | --- | --- |
| 8+ days overdue | More than seven calendar days late | L3 HOD: recovery plan |
| 1-7 days overdue | One through seven days late | L1 Owner: recover now |
| Due in 0-3 days | Due today through three days out | L2 Manager: confirm readiness |
| Due in 4-7 days | Four through seven days out | Plan and monitor |
| Due in 8+ days | More than seven days out | Routine follow-up |
| Missing target date | Open issue has no target date | Set a valid target date |

Closed issues are excluded from this queue. Every visible count comes from the same role-scoped and filtered issue set used by the dashboard.

### Overall issue status

- Donut summarizes classified Closed, On Track, and Overdue issues in the current view.
- Closed is Green, On Track is Yellow, and Overdue is Red.
- Data Gaps are displayed separately in a neutral count, not as a donut segment; the donut is not a complete count of all open tasks when Data Gaps exist.

### Escalation level by role

- Counts open issues by their derived next notification role/level.
- Closed issues are excluded.
- Levels come from `ESCALATION_STAGES` in `lib/rules.js`.

### Top 10 most overdue issues

- Selects open issues with positive days late, sorts most overdue first, and shows up to ten.
- Columns are Issue, Owner, Department, Days overdue, and Escalation level.
- It does not visualize or derive Department from Description.

### KPI detail tables

- Total shows all issues in the filtered KPI set.
- Closed shows closed issues.
- On Track shows open issues with a target date that is not overdue.
- Overdue shows overdue issues.
- These tables preserve Description as readable issue text in its own column and keep Department separate.

### Escalation level by role

- Counts open issues by their derived next notification role/level.
- Closed issues are excluded.
- Levels come from `ESCALATION_STAGES` in `lib/rules.js`.

### Top 10 most overdue issues

- Selects open issues with positive days late, sorts most overdue first, and shows up to ten.
- Columns are Issue, Owner, Department, Days overdue, and Escalation level.
- It does not visualize or derive department from Description.

### KPI detail tables

- Total shows all issues in the filtered KPI set.
- Closed shows closed issues.
- Red, Yellow, and Green show matching open issues.
- These tables preserve Description as readable issue text in a dedicated column and keep Department in its own column.

## 8. Department and Description data rules

These fields have different meanings and must stay separate throughout import, filtering, display, and reporting:

- **Department (`dept`):** structured team/function classification. Used for department filters and summaries. Department aliases are normalized in `lib/departments.js`; missing values become `Unassigned`.
- **Description (`desc` / database `description`):** free-text explanation of the issue. Used as readable text in the register, KPI issue table, and meeting board. It is not a chart dimension and must not be used to infer a department.

Charts and counts are based on structured fields such as Department, RGY, Status, Escalation, and dates. Free-text descriptions are not converted into charts, word clouds, inferred categories, or decorative illustrations.

## 9. Date, RGY, severity, and escalation rules

Rules are derived in `lib/rules.js` from raw `due` and `closed` dates against local start-of-day. Dates are parsed as local dates to avoid UTC/time-zone day shifts.

| Condition | Status | RGY | Severity | Escalation | Risk |
| --- | --- | --- | --- | --- | --- |
| Closed date exists | Closed | Green | Closed | None | 0 |
| No target date and not closed | Open | Gap | Critical - Data Gap | Neutral | 100 |
| 1-7 days overdue | Overdue | Red | Medium | L1 Owner | `50 + days late * 5` |
| More than 7 days overdue | Overdue | Red | Critical | L3 HOD | `50 + days late * 5` |
| Due today through 3 days | Open | Yellow | Watch | L2 Manager | 30 |
| More than 3 days until due | Open | Green | Normal | Neutral | 10 |

Derived alerts and next actions include overdue recovery, upcoming pre-alert, and missing-target-date prompts. A task with a closed date is treated as Closed regardless of its due date.

Table row backgrounds are status cues independent of RGY: Closed is blue, Overdue is red, dates within 0–3 days are yellow, and dates 7–27 days away are green. The system-wide Red Flag count is not affected by dashboard filters.

## 10. Issue data model and lifecycle

The `tasks` row contains raw tracker/business fields:

- Identity and ownership: `id`, `manager`, `owner`, `member`.
- Classification: `customer`, `program`, `dept`, `description`.
- Dates: `start_date`, `due_date`, `next_date`, `closed_date`.
- Collaboration: `remark`, `custom` JSON.
- System metadata: `created_at`, `updated_at`, `updated_by`.

Status, RGY, severity, alert, next action, escalation, risk, days to due, days late, and management flag are derived by the app from raw dates; they are not the primary stored tracker inputs.

Adding an issue:

- Only a Platform Manager (application role `Manager`) can create a new issue, and only in their own tracker. Supabase RLS and triggers enforce the same rule.
- The form requires manager, program, description, department, owner, start date, and target date. It includes Initial Manager and Resource Name fields and supports proof uploads at creation.
- Program, manager, initial manager, department, and owner choices are offered as selectors; custom program/department values remain supported.
- Task owners may accept or reject a proposed target date within exactly 72 hours; pending proposals are auto-accepted after that deadline. Target dates cannot be blank on authenticated updates, and a revised date may be no more than seven days after the target date.
- The form previews derived status/RGY. A target date before the start date is rejected.
- Demo mode assigns an ID in browser code. Supabase mode assigns an increasing tracker-prefixed ID in a database trigger and records creation in the audit trail.

Editing:

- Optimistic UI update applies immediately; a server failure rolls back the edited fields and displays an error.
- Issue details remain editable after creation until the explicit Close action. The form and inline editor protect required fields, and the issue ID and tracker are locked in the form.
- The edit action is available from the open register/history and beside the close control when proof is ready, so details can be reviewed or corrected before closure.
- After closure, issue details are read-only in the app and enforced as immutable by a database trigger. Use the separate Reopen action before editing; reopening is not a detail edit.
- The shared editable `Sr No` value controls issue order in Daily Update, Dashboard, and Task Register. Edits update local views immediately and synchronize to other sessions through Supabase Realtime.
- Reply authors can edit their own replies; each edit is recorded in issue history. The eye/View control opens the selected proof in the in-app viewer.
- Admin may move a task between trackers; non-admins cannot.

Deleting:

- Managers may delete issues in their own tracker; Admins may delete any issue; Owners cannot delete.
- The app asks for confirmation. Attached proof objects are removed before the task row is deleted. Proof metadata and task events cascade when the task row is deleted.
- If storage deletion fails, the app keeps the issue. A failure after storage removal but before row deletion may require administrator reconciliation.

## 11. Roles and access

| Role | Visible task scope | Typical capabilities |
| --- | --- | --- |
| Admin | All trackers; can choose a manager view | Provision/oversee access, edit/delete permitted open issues, review proof, close/reopen, and reorder issues. Cannot create new issues. |
| Platform Manager (`Manager`) | Rows whose `manager` matches the profile's manager name | Create issues in own tracker, edit open issue details, set shared order, raise Red Flags, import tracker rows, delete own issues, review proof, close/reopen. |
| Dept Head | All visible issues | Department/person management and permitted issue updates; cannot create new issues. |
| Owner | Rows whose `owner` matches profile owner name | View assigned actions, respond to target dates, upload evidence, edit permitted open-issue remarks, raise Red Flags, and edit their own replies. Database policy denies task creation/deletion and Owner reopen. |

Supabase profiles store role and manager/owner scope. New accounts default to Owner and have no issue scope until provisioned. The signup UI accepts `@bremboindia.com` owner accounts; role elevation is not self-service. Admin/Manager access is provisioned separately, documented in `supabase/provision-users.sql`.

RLS on `tasks`, `profiles`, `proofs`, and `task_events`, plus database triggers, is the security boundary. Client-side filtering mirrors the policy for usability but is not the enforcement mechanism.

## 12. Authentication and runtime modes

Runtime mode depends on `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`:

- Both empty: browser-only demo mode with quick logins; no shared server persistence.
- Both present: Supabase mode with password sign-in, owner signup, password reset, session restore, and recovery-password flow.
- Only one present: app shows a partial-configuration error instead of silently switching modes.

Owner signup is restricted to the configured Brembo email domain and creates an Owner account; an administrator must assign the matching owner scope. The service-role secret is never a client environment variable.

## 13. Proofs, storage, and audit

Supported extensions are PDF, PNG/JPG/JPEG/WEBP/GIF, TXT/CSV, DOC/DOCX, XLS/XLSX, PPT/PPTX, MSG, and EML. Files must be non-empty and at most 10 MiB. SVG and HTML are excluded.

- Demo: file bytes in browser IndexedDB, metadata in localStorage.
- Supabase: file bytes in a private `proofs` storage bucket; metadata in `public.proofs`.
- Object paths are scoped by issue ID and use UUID plus a sanitized ASCII filename.
- Viewing/download uses short-lived signed URLs (5 minutes); proof objects are not public.
- Database policies constrain storage reads/uploads by task visibility and extension. Managers/Admins may remove evidence under policy; owner cleanup is restricted to eligible orphan objects.
- Database triggers create audit events for task field updates and proof addition/removal; events inherit the parent task's visibility.
- Realtime subscriptions watch visible task/proof changes and the current profile; the UI refetches affected data.

## 14. Other operational views

### Dashboard

Shows a global Red Flag count across trackers and filters. The overdue recovery table is prominent at the bottom of the page. Dashboard issue rows use the same Closed/Overdue/due-soon/green-window row colors as the register.

### Morning Update

Shows all open issues in editable shared `Sr No` order, with prominent overdue, due-soon, and data-gap counts and attention per owner. Editing `Sr No` synchronizes order across views. The table scrolls horizontally as needed. Routine daily meeting emails are disabled; the weekly report schedule remains.

### Task Register

The active register and Closed Issues are separate views. Searches across issue identity, manager, customer, program, description, department, owner, dates, status, RGY, severity, risk, escalation, remarks, and proof filename. Open rows remain editable until closure; closed rows are locked until reopened. Supports Excel (.xlsx) export with real date cells, status row colors, and horizontal scrolling. Description and Department have separate columns.

### Uploaded Proofs and viewer

Shows proof files for tasks in the current role scope; managers/admins can remove proof, and authorized users can preview/download. Images, PDFs, and text/CSV receive inline previews; other allowed types can be downloaded.

### Top bar

Search can narrow visible work by department and RGY. Notifications include open issues due within the next five days and, for Admin/Manager, visible owner proof uploads. Proof-read time is kept in browser localStorage.

## 15. Data storage

- All issues are created and managed in the app.
- Managers (own tracker) and Admins (any tracker) can import an existing Excel tracker (.xlsx or .csv) from Task Register > Import from Excel. The file is read in the browser (`lib/xlsx-reader.js`, `lib/excel-import.js`). Rows match existing issues by ID / Sr No, or by program + description. Filled-in cells update matching open issues; empty cells never clear values; closed issues are not changed; rows closed in Excel are not added; nothing is deleted. A preview lists every change before saving.
- `supabase/seed.sql` is documented as an initial 977-row seed and uses conflict-safe insertion to preserve rows already changed in Supabase.
- Department aliases are normalized; Department must not be inferred from Description.

## 16. Database and migration history

Main tables:

- `profiles`: Auth user, role, manager name, owner name.
- `tasks`: raw tracker issue row and system metadata.
- `proofs`: attachment metadata; bytes are stored in private Supabase Storage.
- `task_events`: audit event actor/action/detail/time.

Migrations are applied in numeric order. Later migrations enforce Platform Manager-only issue creation, required target dates and owner response deadlines, edit-until-explicit-close, required-field locks, and a system-wide Red Flag count. Migration `0029_issue_edit_lock_red_flag_count.sql` is the latest repository migration; it also disables routine daily email preferences. The scheduled weekly report remains separate.

SQL tests cover role-safe signup, task closure, manager update allow-lists, RLS scope, required issue fields, owner response deadlines, revised-date limits, closed-row locking, and Red Flag counting. They use rollback-safe fixtures but should be run against a disposable/test Supabase project, not production.

## 17. Setup and common commands

From the `brembo-platform` project directory:

```powershell
npm install
npm run dev
npm run lint
npm test
npm run build
```

The app requires Node.js 20.9 or newer. Local development uses Webpack explicitly. Open `http://localhost:3000`.

Demo mode needs both Supabase values empty. Supabase mode needs both values in `.env.local`, all migrations applied in order, user profiles provisioned, and `supabase/seed.sql` run as documented. Deployment is designed for a Next.js host such as Vercel plus Supabase; verify environment variables and SQL policies in the target project before launch.

## 18. Testing and validation

- `npm run lint`: ESLint over `app`, `components`, `lib`, and `next.config.js`.
- `npm test`: Node tests for rules, dashboard aggregations, issue validation/ID generation, and task patch rollback.
- `npm run build`: production Next.js build using Webpack.
- `supabase/tests/run-all.ps1`: SQL integration checks; requires `DATABASE_URL` and `psql`.

Do not place database URLs/passwords in source, prompts, browser code, or `.env.local` when they are privileged credentials.

## 19. Planned versus implemented

Implemented in current application code: role-aware dashboard and register, filters, RGY and escalation derivation, add/delete issue flows, proof upload/review/view/download, Excel export, database-backed audit trail, private storage, and Realtime refresh.

Planned/not implemented: scheduled morning email or Teams notifications and automated owner pre-alert delivery. Do not present planned notification automation as live functionality.

Production rollout still depends on the actual Supabase project, applied migrations, correct user/profile provisioning, validated tracker data, operational policy, monitoring, and support ownership.

## 20. Known discrepancies to resolve

1. **Owner close/reopen affordance:** `TaskRegister.js` and `UploadedProofs.js` render close/reopen controls for Owners, but migration `0003_manager_proof_review.sql` denies Owner closure and the base task guard denies Owner reopen. The database is authoritative; align the UI affordances and user messaging with policy.
2. **README framework version:** `package.json` currently declares Next.js 16.3.8, while `README.md` still says Next.js 14. Update that README line when convenient.
3. **Local demo semantics:** local demo accounts and data are browser-specific. They are suitable for demonstration/testing, not team-shared operational use.
4. **Data gaps:** missing target date produces an Open / Gap issue with Neutral escalation and risk 100. The Dashboard RGY group aggregation includes only Red/Yellow/Green open tasks, so gap issues are included in Total but not the RGY donut/bar segments. The dashboard must not imply those segments partition all open work.

## 21. Department and Description guardrails

- `dept` is a structured organizational category. It can be normalized by explicit aliases in `lib/departments.js`.
- `desc` / database `description` is free text. Show it as text in a separate, clearly labeled column.
- Never infer Department from Description, combine the fields, or use descriptions as chart categories.
- Department charts/counts aggregate only the structured `dept` value. Missing values display as `Unassigned`.
- Do not create word clouds, description-derived categories, or decorative issue-description graphics.

## 22. Source of truth

When descriptions conflict, prefer current implementation and database policy over static UI copy. In production, database migrations/RLS/triggers determine access and permissible writes. The relevant product logic lives in `lib/rules.js`, `lib/dashboard/aggregations.ts`, `lib/store/`, and `supabase/migrations/`.
