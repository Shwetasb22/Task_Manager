# Running the OPL tracker server

How to update the app without downtime, run a test copy beside it, keep backups, get alerts, and
change passwords. Everything here runs on the app server (today 10.91.50.252) under pm2.

## 1. Updating the app (no downtime)

`scripts/deploy.sh` (Linux) and `scripts/deploy.ps1` (Windows) do the whole update:

1. put the new version in its own folder, while the current one keeps serving people;
2. install packages (copied from the running version when nothing changed), run the unit tests, build;
3. start the new version on a spare port and check `/api/health`;
4. switch with `pm2 reload` (the two app copies restart one at a time, so the site never goes down);
5. check `/api/health` on the real port and **switch straight back** if it fails;
6. keep the last 3 versions so you can go back with one command.

If anything fails before step 4, the running site is not touched.

### Folder layout

```
C:\opl-tracker\            (or /opt/opl-tracker on Linux; choose with -Base / --base)
  releases\20261014-0915-a1b2c3d   one folder per version
  shared\.env.local                the settings; edit here, then deploy again
  shared\state\                    backups and "already sent today" markers; survives updates
  current                          link to the version that is running
  repo.git\                        only when deploying from git
```

### First time (moving from the current setup)

Do this once, at a quiet time. It takes about 5 minutes.

```powershell
# 1. Stop the old pm2 apps (the site is down from here until step 4).
pm2 delete opl-tracker opl-digest opl-weekly opl-archive opl-backup
# 2. Make the folders and copy the settings from the current app folder.
mkdir C:\opl-tracker\shared
copy C:\path\to\current\app\.env.local C:\opl-tracker\shared\.env.local
# 3. Copy the "already sent today" markers so nobody gets the morning email twice.
mkdir C:\opl-tracker\shared\state
copy C:\path\to\current\app\.digest-last-sent C:\opl-tracker\shared\state\  # if it exists
# 4. Deploy the new version from the unzipped folder.
powershell -ExecutionPolicy Bypass -File C:\path\to\new\opl_tracker\scripts\deploy.ps1 -From C:\path\to\new\opl_tracker
# 5. Make pm2 start everything after a server restart.
pm2 save
```

On Linux the same with `scripts/deploy.sh --from /path/to/new/opl_tracker` and `/opt/opl-tracker`.

### Every later update

From an unzipped folder:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -From C:\path\to\new\opl_tracker
```

From git (after the first `-Repo https://github.com/ORG/opl_tracker.git`, just run it with no options; it
deploys the `main` branch, or `-Ref other-branch`):

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
```

Defaults can go in `C:\opl-tracker\deploy.env` (lines like `REPO=...`, `REF=main`, `PORT=3000`, `PREFIX=opl`).

### Going back

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -Rollback
```

switches to the previous version in a few seconds. A version that failed or was rolled back is kept as
`releases\<name>.failed` / `.rolled-back` (the last two of each) so its `build.log`, `test.log` and
`trial.log` can be read.

**Database updates are not rolled back.** Apply them first (section 3), then deploy. The updates in
this version only add to the database, so the version that is running keeps working while you apply them.

### Health check

`http://SERVER:3000/api/health` answers `{"ok":true,"release":"…","db":"ok"}` (200), or `"ok":false`
with status 503 when the app cannot reach Supabase. The deploy scripts and the watchdog (section 5) use it.

## 2. A test copy beside the real one

Use it to try a new version, or a database update, before people see it.

1. **Test Supabase project.** In Supabase, create a second project (for example `opl-tracker-test`).
   Apply the database updates to it (section 3, with the test project's connection string), then run
   `supabase/seed.sql` in its SQL Editor for sample data, or load a copy of real data from a backup
   (section 4, "Copy real data into the test project"). Create a few test logins
   (Authentication → Users) and set their roles as described in SETUP.md.
2. **Settings.** Make `C:\opl-test\shared\.env.local` with the **test** project's URL and keys,
   `APP_URL=http://10.91.50.252:3100`, and **leave `DIGEST_SMTP_HOST` and the Teams webhooks empty** so the
   test copy never emails or posts to real people.
3. **Deploy it** on its own port with its own pm2 names:

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -Base C:\opl-test -Port 3100 -Prefix opl-test -From C:\path\to\new\opl_tracker
   ```

   It runs as `opl-test-tracker` (and `opl-test-digest`, …) at `http://10.91.50.252:3100`, completely
   separate from the real app. Remove it with `pm2 delete /^opl-test-/`.

## 3. Database updates

`supabase/apply-migrations.ps1` (Windows) or `supabase/apply-migrations.sh` (Linux) runs the files in
`supabase/migrations` that the database has not had yet, in order, and remembers which ones ran (in
`opl_admin.schema_migrations`, which the app's API cannot see). It needs `psql` (PostgreSQL client tools).

```powershell
$env:DATABASE_URL = 'postgresql://postgres.xxxx:PASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres'
# Supabase → Project Settings → Database → Connection string → URI ("Session pooler")
.\supabase\apply-migrations.ps1 -DryRun          # see what would run
.\supabase\apply-migrations.ps1 -Baseline 0014   # FIRST TIME ONLY: 0001-0014 were already run by hand
.\supabase\apply-migrations.ps1                  # apply the rest
```

Use `-Baseline` with the number of the last update you already ran in the SQL Editor; those are recorded
without running again. Try on the test project first. The runner stops at the first error, and a failed
update is not recorded, so fixing the cause and running it again carries on from there.

Running the files by hand in the SQL Editor (in number order) still works too.

## 4. Backups

`opl-backup` runs every night at 23:30 and writes `shared\state\backups\YYYY-MM-DD\data.json.gz`
(every table: issues, History, comments, proofs list, people, trackers, departments, saved views) and
copies each proof file once into `shared\state\backups\files\`. The last 30 days are kept
(`BACKUP_KEEP_DAYS`); proof files are never deleted from the backup. This is in addition to Supabase's
own backups, and keeps working if the Supabase project is paused, deleted or locked.

**Copy the backups folder off the server** now and then (or point `OPL_STATE_DIR` at a network share):
a backup on the same disk does not survive the disk.

```powershell
node scripts\backup.mjs                                   # back up now
node scripts\backup.mjs --check shared\state\backups\2026-10-14   # what is in a backup
```

### Restoring

```powershell
node scripts\backup.mjs --to-sql C:\opl-tracker\shared\state\backups\2026-10-14 > restore.sql
```

Run `restore.sql` in the Supabase SQL Editor (or `psql "$env:DATABASE_URL" -f restore.sql`). It only
**adds rows that are missing**; rows that exist are left as they are. So it repairs an accidental delete
without undoing later work. Then put back missing proof files:

```powershell
node scripts\backup.mjs --restore-files
```

Logins are not part of the backup (they live in Supabase Authentication). On a different project,
people sign up again; profiles and saved views come back for logins that exist.

### Copy real data into the test project

Make `restore.sql` as above from a real backup and run it on the **test** project after its migrations.

## 5. Alerts

Set `ALERT_TEAMS_WEBHOOK` in `shared\.env.local` (Teams → channel → Workflows → "Post to a channel when a
webhook request is received"; it can be the same channel as the morning update) and deploy again. Then:

- **App down:** `opl-health` checks `/api/health` every 5 minutes. After 2 failed checks in a row it
  posts "OPL tracker is down" with the reason, and "working again" when it recovers.
- **Backups stopped:** if no backup was written for 2 days, it posts once a day until fixed.
- **Errors in people's browsers** are sent to the server and written to `pm2 logs opl-tracker`
  (lines starting with `[client-error]`). With the webhook set, each different error is also posted,
  at most once every 30 minutes and 10 posts an hour.

pm2 itself restarts the app if it crashes.

## 6. Changing passwords and keys

Change these when someone who knew them leaves, if a copy of `.env.local` left the server (for example
in a zip sent by email or uploaded anywhere), or once a year. After each change, update
`shared\.env.local` and deploy again (section 1) so the app picks it up.

| What | Where to change it | Notes |
|---|---|---|
| Database password | Supabase → Project Settings → Database → Reset database password | Only scripts that connect with `psql` / `DATABASE_URL` use it. The app does not. |
| Service role key (`SUPABASE_SERVICE_ROLE_KEY`) | Supabase → Project Settings → API Keys | Used only by the server scripts (emails, backups, archive). With the new API keys, create a new secret key, deploy, then delete the old one: no downtime. The legacy `service_role` key can only be changed by rotating the JWT secret, which also changes the anon key and signs everyone out. |
| Public key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) | Same page | Not a secret (every browser gets it); the database rules protect the data. Changing it needs a deploy because it is built into the pages. |
| SMTP password (`DIGEST_SMTP_PASS`) | Brembo IT | |
| Teams webhooks | Teams → channel → Workflows | Anyone with the URL can post to the channel: replace it if it leaks. |
| People's passwords | Supabase → Authentication → Users → Send password recovery | People can also use "Forgot password" on the sign-in screen. |

Never put these values in the git repository, in chat, or in email. `.env.local` is excluded from git
and from the deploy copies' zips.

## 7. Automatic checks (CI)

`.github/workflows/ci.yml` runs on GitHub for every push and pull request: lint, unit tests, a build,
every database update on a throwaway PostgreSQL (twice, to prove they are safe to re-run) and all the SQL
tests. It needs no secrets and never touches Supabase. A red check on a pull request means: do not deploy
that version.

## 8. pm2 apps

| Name | What | When |
|---|---|---|
| opl-tracker | the web app (2 copies) | always |
| opl-digest | morning alert email and Teams card | 08:30 Mon–Sat |
| opl-weekly | weekly report email | Monday 09:00 |
| opl-archive | archives issues closed over a year ago | Sunday 23:45 |
| opl-backup | nightly backup | 23:30 |
| opl-health | watchdog alerts | every 5 minutes |

`pm2 status` shows them; `pm2 logs <name>` shows what each did. The scheduled ones show "stopped" between
runs; that is normal.
