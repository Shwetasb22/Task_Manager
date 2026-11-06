# Brembo India Program Command

A Next.js operations dashboard for Brembo India tracker management, including login-first access, issue tracking, proof handling, and executive summaries.

## What the app does

- opens to a login screen before protected content is shown
- supports Admin / Dept Head / Platform Manager / Owner role scoping
- loads tracker tasks with status, escalation, and due-date logic
- restricts new issue creation to Platform Managers and requires a target date
- keeps Closed Issues in a dedicated view, separate from the active register
- gives task owners three days to respond to a proposed target date before auto-acceptance
- keeps issue details editable until explicit closure; closed issues must be reopened before detail edits
- stores editable Sr No ordering across the Daily Update, dashboard, and register
- highlights closed (blue), overdue (red), due within three days (yellow), and due in 7–27 days (green)
- shows a system-wide Red Flag total and lets comment authors edit their replies
- limits revised dates to seven days after the target date
- supports proof upload, review, and removal controls
- allows Managers to permanently delete issues in their own tracker and Admins to delete any issue
- provides dashboard, Daily Update, active register, Closed Issues, and proof views
- stores production issues and proof metadata in Supabase with manager-scoped row-level security
- supports demo mode for local development

## Current status

This project is in a verified working state for local development and a GitHub-ready handoff.

Verified in this environment:
- login-first app flow
- rule-based due-date / overdue logic
- Node-based regression tests
- production Next.js build

## Stack

- Next.js 14
- React 18
- Tailwind CSS
- Recharts
- Supabase-backed production storage

## Project structure

- [app/page.js](app/page.js) — app entry, session validation, protected view gating
- [components/AuthScreen.js](components/AuthScreen.js) — login and demo access flow
- [components/Dashboard.js](components/Dashboard.js) — KPI and operational overview
- [components/TaskRegister.js](components/TaskRegister.js) — tracker register and proof operations
- [components/ProofViewer.js](components/ProofViewer.js) — proof preview and file download flow
- [supabase/seed.sql](supabase/seed.sql) — current 977-row initial tracker import
- [lib/store/index.js](lib/store/index.js) — runtime config and store selection
- [lib/store/local.js](lib/store/local.js) — browser demo mode persistence
- [lib/store/supabase.js](lib/store/supabase.js) — Supabase production store
- [lib/rules.js](lib/rules.js) — status and escalation business logic
- [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql) — base database schema and RLS setup
- [supabase/migrations](supabase/migrations) — ordered production schema and security changes through migration 0029
- [supabase/migrations/0011_task_delete.sql](supabase/migrations/0011_task_delete.sql) — manager-scoped task deletion
- [supabase/tests](supabase/tests) — rollback-safe SQL integration checks for signup, closure, field allow-list, and RLS scope

## Prerequisites

- Node.js 20.9 or newer
- npm 9+
- optional: Supabase project for production mode

## Quick start

1. Open the project folder in VS Code.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the app:
   ```bash
   npm run dev
   ```
4. Open http://localhost:3000

## Environment setup

Copy [.env.example](.env.example) to [.env.local](.env.local) and fill in the Supabase values if you want production mode.

- leave both values empty to use the browser-only demo mode
- set both values to enable Supabase-backed auth and data flow

## Production mode

When both variables are set, the app switches to Supabase mode automatically.

Required values:
```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-key
```

Do not add service-role secrets to the browser app.

Apply migrations in numeric order through `0029_issue_edit_lock_red_flag_count.sql` and run [supabase/seed.sql](supabase/seed.sql) in the Supabase SQL editor to insert missing tracker rows. Issues are stored in one `tasks` table with a manager field; row-level security keeps each manager scoped to their own tracker. Platform Managers create issues in their own tracker, with a required target date; owners have three days to accept or reject proposals, after which they are auto-accepted. Details remain editable until explicit closure; closed issues are read-only until reopened. The shared `Sr No` value controls order across views, and the dashboard shows a system-wide Red Flag total. A Platform Manager with an existing Excel tracker can load it from Task Register > Import from Excel: the app previews new rows and changes before saving. Routine morning meeting emails are disabled; weekly reports remain.

## Validation

Run the app unit tests and production build before pushing changes:
```bash
npm test
npm run build
```

The SQL integration scripts run separately against a Supabase database after applying all migrations in numeric order. Run the complete suite in dependency order with PowerShell and `psql` installed:

```powershell
$env:DATABASE_URL = 'postgresql://postgres:[PASSWORD]@[HOST]:5432/postgres'
./supabase/tests/run-all.ps1
```

You can also pass `-DatabaseUrl` to the script. It stops on the first SQL failure and prints a pass/fail summary. Individual scripts can also be run in the Supabase SQL editor.

- [supabase/tests/signup_role.sql](supabase/tests/signup_role.sql) — submitted admin/manager signup metadata is ignored.
- [supabase/tests/task_closure.sql](supabase/tests/task_closure.sql) — owner closure is denied, owner proof metadata upload works, manager/admin closure with proof works.
- [supabase/tests/manager_update_allowlist.sql](supabase/tests/manager_update_allowlist.sql) — manager edits are limited to allowed columns; admin changes remain allowed.
- [supabase/tests/rls_access.sql](supabase/tests/rls_access.sql) — cross-manager reads/updates and proof inserts are denied; in-scope proof metadata inserts work.
- [supabase/tests/proof_storage_delete.sql](supabase/tests/proof_storage_delete.sql) — owners can clean up their orphaned uploads but cannot delete proof on a closed issue.
- [supabase/tests/owner_proof_remove.sql](supabase/tests/owner_proof_remove.sql) — owners can remove proof they uploaded on an open issue, not anyone else's and not after closure.
- [supabase/tests/platform_manager_creation.sql](supabase/tests/platform_manager_creation.sql) — covers role-gated creation, required fields, the three-day response rule, closure locking, seven-day revised dates, and global Red Flag counting.

These scripts create temporary fixtures in transactions and roll them back. Do not run them against production unless the database role can safely insert test rows into `auth.users`; a disposable local Supabase database is preferred.

## Notes

- the login screen is intentionally the first visible page
- demo mode is suitable for local testing only
- the production backend should remain the enforcement point for auth, RBAC, and proof access
