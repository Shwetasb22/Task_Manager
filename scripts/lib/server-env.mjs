// Shared by the server scripts (daily alerts, backups): reads .env.local and opens a Supabase client
// with the service role key, which can read every row. That key must stay on the server only.
import fs from 'node:fs';
import path from 'node:path';

export function loadEnv(root) {
  const env = { ...process.env };
  for (const file of ['.env', '.env.local']) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    fs.readFileSync(full, 'utf8').split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m || line.trim().startsWith('#')) return;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[m[1]] === undefined) env[m[1]] = v;
    });
  }
  return env;
}

export async function serviceClientAsync(env) {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Where the scripts keep files that must survive an update (sent-today stamps, backups):
// OPL_STATE_DIR when set (scripts/deploy.* sets it to <base>/shared/state), else the app folder.
export function stateDir(root, env) {
  const dir = env.OPL_STATE_DIR ? path.resolve(root, env.OPL_STATE_DIR) : root;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

let client;
export function serviceClient(env) {
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local on the server (Supabase → Project Settings → API → service_role).');
  }
  if (!client) client = serviceClientAsync(env);
  return client;
}

// Reads a whole table in pages of 1000 (the Supabase default limit).
export async function fetchAll(dbPromise, table, columns, filter = (q) => q) {
  const db = await dbPromise;
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await filter(db.from(table).select(columns)).order(table === 'task_events' ? 'id' : table === 'profiles' ? 'created_at' : 'id').range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

// Database row -> the field names the app's rules use (same as lib/store/supabase.js).
export function mapTaskRow(r) {
  return {
    id: r.id, manager: r.manager, program: r.program, desc: r.description, dept: r.dept || 'Unassigned', customer: r.customer || '',
    owner: r.owner, member: r.member || '', start: r.start_date, due: r.due_date, next: r.next_date, closed: r.closed_date,
    remark: r.remark || '', createdAt: r.created_at,
  };
}
