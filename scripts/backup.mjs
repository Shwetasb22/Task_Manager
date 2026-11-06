#!/usr/bin/env node
// Nightly copy of all tracker data, kept on the app server (pm2 runs it at 23:30, see ecosystem.config.js).
// This is an extra copy beside Supabase's own backups: it keeps working if the Supabase project is
// deleted, paused or locked, and it lets you copy real data into a test project.
//
//   node scripts/backup.mjs                    back up now into <state>/backups/<date>/
//   node scripts/backup.mjs --check DIR        print what a backup holds
//   node scripts/backup.mjs --to-sql DIR > restore.sql
//        SQL that puts the backup's rows back (Supabase → SQL Editor, or psql). Rows that still exist
//        are left alone, so it can also fill gaps after an accidental delete. Run the migrations first.
//   node scripts/backup.mjs --restore-files    upload proof files that are missing from Storage
//
// <state> is OPL_STATE_DIR (set by scripts/deploy.*) or the app folder. Settings in .env.local:
// SUPABASE_SERVICE_ROLE_KEY (required), BACKUP_KEEP_DAYS (default 30), BACKUP_FILES=false to skip
// proof files (they are copied once each into <state>/backups/files/ and never deleted from there).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadEnv, serviceClient, stateDir } from './lib/server-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = loadEnv(root);
const args = process.argv.slice(2);
const BUCKET = 'proofs';

// In restore order (parents first). key = column to page by; auth = columns pointing at a login.
const TABLES = [
  { name: 'trackers', key: 'name' },
  { name: 'departments', key: 'code' },
  { name: 'employees', key: 'id' },
  { name: 'profiles', key: 'id', needsUser: 'id' },
  { name: 'tasks', key: 'id', auth: ['updated_by'] },
  // Highest issue number ever given out per prefix (0024), so restored data never reuses one.
  { name: 'task_id_counters', key: 'prefix', onConflict: 'on conflict (prefix) do update set last_no = greatest(public.task_id_counters.last_no, excluded.last_no)' },
  { name: 'task_events', key: 'id', identity: true },
  { name: 'proofs', key: 'id', auth: ['uploaded_by'] },
  { name: 'task_comments', key: 'id', identity: true, auth: ['author'] },
  { name: 'saved_views', key: 'id', needsUser: 'user_id' },
];

const backupsDir = () => path.join(stateDir(root, env), 'backups');
const today = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD, server time

async function readTable(db, t) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(t.name).select('*').order(t.key).range(from, from + 999);
    if (error) {
      // A table added by a later database update that this database does not have yet.
      if (/does not exist|schema cache|PGRST205|42P01/.test(`${error.code} ${error.message}`)) return null;
      throw new Error(`${t.name}: ${error.message}`);
    }
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

async function backup() {
  const db = await serviceClient(env);
  const dir = path.join(backupsDir(), today());
  fs.mkdirSync(dir, { recursive: true });
  const data = { takenAt: new Date().toISOString(), source: env.NEXT_PUBLIC_SUPABASE_URL, tables: {} };
  for (const t of TABLES) {
    const rows = await readTable(db, t);
    if (rows) data.tables[t.name] = rows;
  }
  const file = path.join(dir, 'data.json.gz');
  fs.writeFileSync(`${file}.tmp`, zlib.gzipSync(JSON.stringify(data)));
  fs.renameSync(`${file}.tmp`, file); // never leave a half-written backup under the real name
  const counts = Object.entries(data.tables).map(([k, v]) => `${k} ${v.length}`).join(', ');
  console.log(`Backup written to ${file}: ${counts}.`);

  if (String(env.BACKUP_FILES ?? 'true') !== 'false') {
    let copied = 0; let failed = 0;
    for (const p of data.tables.proofs || []) {
      const target = path.join(backupsDir(), 'files', p.path);
      if (fs.existsSync(target)) continue;
      const { data: blob, error } = await db.storage.from(BUCKET).download(p.path);
      if (error) { failed += 1; console.warn(`  could not copy ${p.path}: ${error.message}`); continue; }
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, Buffer.from(await blob.arrayBuffer()));
      copied += 1;
    }
    console.log(`Proof files: ${copied} new file(s) copied${failed ? `, ${failed} failed` : ''}.`);
    if (failed) process.exitCode = 1;
  }
  prune();
}

function prune() {
  const keep = Number(env.BACKUP_KEEP_DAYS || 30);
  const days = fs.readdirSync(backupsDir()).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  days.slice(0, Math.max(0, days.length - keep)).forEach((d) => fs.rmSync(path.join(backupsDir(), d), { recursive: true, force: true }));
}

function load(dir) {
  const file = fs.statSync(dir).isDirectory() ? path.join(dir, 'data.json.gz') : dir;
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
}

// Dollar-quoted so any text in the data is safe inside the SQL.
function literal(json) {
  let tag = 'opl';
  while (json.includes(`$${tag}$`)) tag += 'x';
  return `$${tag}$${json}$${tag}$`;
}

function toSql(dir) {
  const data = load(dir);
  const out = [
    `-- Restore of the OPL tracker backup taken ${data.takenAt}. Rows that already exist are kept as they are.`,
    '-- Logins (auth.users) are not part of the backup: people sign in again with their own accounts.',
    '-- Profiles and saved views come back only for logins that exist; other links to a missing login are left empty.',
    'begin;',
  ];
  for (const t of TABLES) {
    const rows = data.tables[t.name];
    if (!rows || !rows.length) continue;
    const cols = Object.keys(rows[0]);
    const select = cols.map((c) => ((t.auth || []).includes(c)
      ? `(select u.id from auth.users u where u.id = r.${c})`
      : `r.${c}`)).join(', ');
    const where = t.needsUser ? ` where exists (select 1 from auth.users u where u.id = r.${t.needsUser})` : '';
    out.push(`-- ${t.name}: ${rows.length} row(s)`);
    out.push(`alter table public.${t.name} disable trigger user;`);
    out.push(`insert into public.${t.name} (${cols.join(', ')})${t.identity ? ' overriding system value' : ''}
select ${select} from jsonb_populate_recordset(null::public.${t.name}, ${literal(JSON.stringify(rows))}::jsonb) r${where}
${t.onConflict || 'on conflict do nothing'};`);
    out.push(`alter table public.${t.name} enable trigger user;`);
    if (t.identity) out.push(`select setval(pg_get_serial_sequence('public.${t.name}', 'id'), greatest((select max(id) from public.${t.name}), 1));`);
  }
  out.push('commit;');
  process.stdout.write(`${out.join('\n')}\n`);
}

async function restoreFiles() {
  const db = await serviceClient(env);
  const filesDir = path.join(backupsDir(), 'files');
  const { data: proofs, error } = await db.from('proofs').select('path, mime');
  if (error) throw new Error(error.message);
  let restored = 0; let missing = 0;
  for (const p of proofs) {
    const { error: e } = await db.storage.from(BUCKET).download(p.path);
    if (!e) continue;
    const file = path.join(filesDir, p.path);
    if (!fs.existsSync(file)) { missing += 1; continue; }
    const up = await db.storage.from(BUCKET).upload(p.path, fs.readFileSync(file), { contentType: p.mime || undefined, upsert: false });
    if (up.error) throw new Error(`${p.path}: ${up.error.message}`);
    restored += 1;
  }
  console.log(`${restored} proof file(s) uploaded again${missing ? `; ${missing} not in the backup` : ''}.`);
}

async function main() {
  if (args.includes('--check')) {
    const data = load(args[args.indexOf('--check') + 1]);
    console.log(`Taken ${data.takenAt} from ${data.source}`);
    Object.entries(data.tables).forEach(([k, v]) => console.log(`  ${k}: ${v.length}`));
  } else if (args.includes('--to-sql')) {
    toSql(args[args.indexOf('--to-sql') + 1]);
  } else if (args.includes('--restore-files')) {
    await restoreFiles();
  } else {
    await backup();
  }
}

main().catch((e) => { console.error(`Backup failed: ${e.message || e}`); process.exitCode = 1; });
