# OPL Tracker v2: what is new and how to install it

## What is new

**For everyone**

1. **Employee list (People page).** One list of everyone who can own an issue. Owner fields pick from it, so names are spelled the same everywhere. Admins and managers can add, edit, hide and rename people (renaming updates every issue).
2. **Morning alert email and Teams card.** At 08:30 (Monday to Saturday) each person gets their overdue and soon-due issues; managers get their tracker, admins everything. Each person can switch it off. Optional card in a Teams channel.
3. **Bulk edit.** Tick several issues in the Task Register and change the owner, target date, next date or department of all of them at once, add a remark to all, or close / reopen / delete them.
4. **Saved views.** "Save this view" keeps a search and filter as a named button, so you get back to it in one click.
5. **Comments with @mentions.** "View · Comment" on an issue shows its History and lets people comment. Type @ to mention someone; they see it under the bell.
6. **Weekly report.** A Weekly Report page (Save as PDF) with this week against last week, and a Monday 09:00 email to admins and managers.
7. **Faster opening.** The app keeps the issues in the browser and only downloads what changed since last time (464 KB the first time, about 65 KB after that).
8. **Excel import is all or nothing.** The whole sheet is saved in one step; if one row is wrong, nothing is saved and the message names the Excel row. It also stops if someone changed an issue after you opened the preview.
9. **Trackers and departments as lists (admins: Lists page).** Rename or merge trackers, merge old department spellings into the standard ones (one click for the known ones, such as ENGG into PE), hide old entries from the pickers.
10. **Archive.** Issues closed more than a year ago are not downloaded when the app opens, so it stays fast over the years. "Show archived" in the Task Register brings them in; reopening one makes it live again.

**For whoever runs the server** (details in `docs/OPERATIONS.md`)

11. **Safe updates.** `scripts/deploy.ps1` / `deploy.sh` build the new version beside the running one, try it, switch with no downtime, and switch back by themselves if it is not healthy. `-Rollback` goes back in seconds. A test copy can run beside the real one on port 3100 with its own test Supabase project. `supabase/apply-migrations.*` runs only the database updates that are missing. GitHub checks every change automatically (`.github/workflows/ci.yml`).
12. **Safety.** Nightly backup of all data and proof files on the server, with a restore. Teams alerts when the app is down, when backups stop, and when people hit errors. Security headers on every page. Two package updates for known security problems. A guide for changing passwords and keys.

**Fixed along the way**

- Deleting an issue that had proof files failed with a "foreign key" error, after the files had already been removed (database update 0023).
- Right after uploading a proof it could show twice until the page was reloaded.
- Typing quickly straight after picking an @name could put letters in the wrong place.
- Issue numbers are never reused. Before, deleting the newest issue of a tracker gave its number to the
  next new issue, so an old printout or email could point at a different issue (database update 0024).

Nothing changed in who can do what.

## Install

Do these in order. Total time about 20 minutes.

### 1. Database (Supabase)

Run the database updates you do not have yet, **in number order**: `0015` to `0024` in `supabase/migrations`
(0015 employees, 0016 daily alerts, 0017 saved views, 0018 comments, 0019 fast loading, 0020 Excel import,
0021 lists, 0022 archive, 0023 delete fix, 0024 issue numbers never reused). Each one is safe to run twice.

Either paste each file into Supabase → SQL Editor → Run, or use the runner once (it records 0001–0014 as done):

```powershell
$env:DATABASE_URL = '<Supabase → Project Settings → Database → Connection string → URI>'
.\supabase\apply-migrations.ps1 -Baseline 0014
```

The running app keeps working while you do this.

### 2. Settings on the server

Add to `.env.local` (see `.env.example` for all of them):

| Setting | Needed for |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | emails, weekly report, archive, backups (Supabase → Project Settings → API Keys; secret key) |
| `APP_URL=http://10.91.50.252:3000` | links in emails |
| `DIGEST_SMTP_HOST`, `DIGEST_SMTP_PORT`, `DIGEST_FROM` (and user/password if the relay needs them) | emails; ask Brembo IT for the internal SMTP relay. Without them, emails are skipped. |
| `DIGEST_TEAMS_WEBHOOK` | optional morning card in a Teams channel |
| `ALERT_TEAMS_WEBHOOK` | optional alerts (app down, backups stopped, errors) |

### 3. Deploy

The first time, follow `docs/OPERATIONS.md` section 1, "First time". It moves the app into the release
folders, after which every update is one command with no downtime:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -From C:\path\to\opl_tracker-v2
```

If you prefer the old way for now: copy the files, `npm ci`, `npm run build`, then
`pm2 startOrReload ecosystem.config.js && pm2 save` (this also starts the scheduled jobs).

### 4. Check

- `http://10.91.50.252:3000/api/health` shows `"ok":true` and `"db":"ok"`.
- `pm2 status` lists opl-tracker (2, online) and opl-digest, opl-weekly, opl-archive, opl-backup, opl-health.
- Admin: the Lists page shows your trackers and departments; merge the suggested department spellings.
- `node scripts\daily-digest.mjs --dry-run` writes the morning emails to `digest-preview\` without sending.
- `node scripts\backup.mjs` writes the first backup.

## Two things to know

- **Issue numbers.** From update 0024 on, a number is never given out twice, even after its issue is
  deleted. Numbers of issues deleted before you apply 0024 cannot be known any more, so the newest
  of those could still come back once.
- **What was tested here and what was not.** Everything was tested against a local copy of the database
  and a local stand-in for Supabase, never your live project. The Linux deploy script and the PowerShell
  deploy script were both tested end to end with pm2 (including automatic switch-back). The
  Windows-only parts of `deploy.ps1` (junction links, robocopy) could not be run here, so try the first
  deploy on the test copy (port 3100) before the real one.
