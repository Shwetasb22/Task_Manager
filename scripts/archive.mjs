#!/usr/bin/env node
// Archives issues closed more than ARCHIVE_DAYS (default 365) days ago. Runs from pm2 every Sunday at
// 23:45 (see ecosystem.config.js); safe to run by hand at any time:   node scripts/archive.mjs
// Archived issues stay in the database and History; the app just stops downloading them on open.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, serviceClient } from './lib/server-env.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = loadEnv(root);

async function main() {
  const days = Number(env.ARCHIVE_DAYS || 365);
  const db = await serviceClient(env);
  const { data, error } = await db.rpc('archive_closed_tasks', { p_days: days });
  if (error) throw new Error(/archive_closed_tasks/.test(error.message) ? 'Run the 0022_archive.sql database update first.' : error.message);
  console.log(`${data} issue(s) closed more than ${days} days ago archived.`);
}

main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
