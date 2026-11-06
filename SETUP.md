# Setup guide

This project can run in two modes:

- demo mode: no external config needed, browser-only storage
- production mode: Supabase-backed auth, tasks, and proof storage

The app intentionally opens to the login screen first in both modes.

## 1. Install dependencies

```bash
npm install
```

## 2. Start locally

```bash
npm run dev
```

Open http://localhost:3000

## 3. Demo mode

Leave both Supabase variables empty in [.env.local](.env.local).

The app will fall back to local data persistence and quick-login demo users.

## 4. Production mode with Supabase

Create a Supabase project and fill both values in [.env.local](.env.local):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-key
```

Apply every SQL migration in [supabase/migrations](supabase/migrations) in numeric order, from `0001_init.sql` through the latest migration. In the Supabase SQL editor, run each file once in that order; with the Supabase CLI, use `supabase db push` after linking the project. The order matters because later migrations harden signup and add database-enforced review rules on top of the initial schema. Production must include `0003_manager_proof_review.sql`, `0025_assignment_import_roles.sql`, `0026_vishal_admin.sql`, `0027_manager_change_tracker.sql`, `0028_platform_manager_creation_target_date.sql`, and `0029_issue_edit_lock_red_flag_count.sql`.

Migration `0025_assignment_import_roles.sql` is required for the current role model (`admin`, `dept_head`, `manager`, `owner`), unrestricted assignment to listed employees, assignment history, and department/person management. Migration `0026_vishal_admin.sql` gives Vishal Shinde the same admin role and full Team-view access as Naveen Sahni, while retaining his separate dept-head permission to edit owner names. Apply migrations in order before using these features. They target this repository's existing `tasks`, `profiles`, `employees`, and `departments` schema; they do not use `issues` or `people` tables.

Migration `0028_platform_manager_creation_target_date.sql` restricts authenticated issue creation to Platform Managers and requires a target date on authenticated updates. It leaves legacy rows unchanged. Migration `0027_manager_change_tracker.sql` provides owner response state and the three-day auto-accept function; `0028` enables and schedules `pg_cron` when available, with an in-app fallback. Migration `0029_issue_edit_lock_red_flag_count.sql` makes closed issue details read-only until an explicit reopen, protects required fields, blocks status-only closure, and adds a system-wide Red Flag count. Target dates must exist; revised dates may be no more than seven days after the target date.

Daily issue order is stored in the shared `Sr No` field and synchronizes across the Daily Update, Dashboard, and Task Register views. Status rows use blue for closed, red for overdue, yellow for due within three days, and green for due in 7–27 days. Routine morning meeting emails are disabled; the weekly report email remains scheduled.

Migration `0011_task_delete.sql` enables permanent task deletion in the Task Register: Managers can delete only rows in their own tracker, and Admins can delete rows from any tracker. Owners cannot delete tasks. Attached proof files are removed before the task row; proof metadata and task audit events cascade with the deleted task.

### Import the tracker data

The live application reads and writes issues in the Supabase `public.tasks` table. Each issue has a `manager` value, and row-level security restricts Platform Managers to creating issues in their own tracker; separate tables per manager are not needed.

The checked-in [supabase/seed.sql](supabase/seed.sql) contains an initial 977-row tracker import. Run it once in the Supabase SQL editor after applying the migrations. It uses `ON CONFLICT (id) DO NOTHING`, so it adds missing rows and preserves any existing Supabase edits.

New issues, edits, remarks, closures, and proof uploads are saved directly to Supabase. Details remain editable until explicit closure; closed issues must be reopened before detail edits. New issues get the next tracker ID; their displayed order is controlled by the editable shared `Sr No` value.

### Post-deploy verification

- Confirm the applied migration history includes `0001_init.sql`, `0002_owner_signup_safety.sql`, `0003_manager_proof_review.sql`, and every later migration in numeric order.
- Run [supabase/tests/signup_role.sql](supabase/tests/signup_role.sql) against the deployed database. It creates test fixtures inside a transaction and rolls them back.
- Run [supabase/tests/task_closure.sql](supabase/tests/task_closure.sql) against the deployed database to verify owner close denial, continued owner proof-metadata uploads, and manager/admin closure after proof exists.
- Run [supabase/tests/manager_update_allowlist.sql](supabase/tests/manager_update_allowlist.sql) after migration 0006 to verify manager field restrictions, future-column blocking, and unchanged admin updates.
- Run [supabase/tests/rls_access.sql](supabase/tests/rls_access.sql) after migration 0005 to verify cross-manager isolation and proof metadata permissions.
- Run [supabase/tests/add_issue.sql](supabase/tests/add_issue.sql) and [supabase/tests/platform_manager_creation.sql](supabase/tests/platform_manager_creation.sql) after migration 0029 to verify Platform Manager-only creation, required fields, explicit closure, the seven-day revised-date limit, and the global Red Flag count.
- Run [supabase/tests/proof_storage_delete.sql](supabase/tests/proof_storage_delete.sql) after migration 0007 to verify uploader cleanup applies only to orphaned objects.
- Apply migrations 0005 and 0007 before relying on uploader-side cleanup after a failed proof metadata insert. Use [supabase/maintenance/reconcile-proof-storage.sql](supabase/maintenance/reconcile-proof-storage.sql) to find proof metadata without a file and proof-bucket objects without metadata.
- To run every SQL test in dependency order, set `DATABASE_URL` and run `./supabase/tests/run-all.ps1` from the project root in PowerShell. The script requires `psql` on `PATH`, stops at the first failing test, and prints a summary.
- Using a disposable account and a name that matches a tracker Owner, attempt signup with user metadata containing `role: "admin"` and a forged `manager_name`. Confirm the resulting `profiles.role` is `owner`, `manager_name` is null, and `owner_name` matches the tracker entry. Remove the disposable Auth user after verification.
- Confirm an owner cannot close an issue through the API, while an authorized manager can close an issue only after proof is attached.

## 5. Recommended operational setup

- disable self-signup in Supabase auth
- add users manually and assign their roles
- keep the repo private if it contains operational data
- ensure RLS and storage policies are enforced in the database as the real access boundary

## 6. Validation

Before pushing changes:

```bash
npm test
npm run build
```

## 7. Deployment

The app runs on the Brembo server under pm2. Updates (with no downtime and one-command rollback), a test
copy beside the real one, database updates, backups, alerts and password changes are described in
[docs/OPERATIONS.md](docs/OPERATIONS.md).
