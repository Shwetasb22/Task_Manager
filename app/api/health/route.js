// Health check for deploys and monitoring: GET /api/health
// 200 {"ok":true,...} when the app runs and (in Supabase mode) the database answers; 503 otherwise.
// The deploy script waits for this before switching traffic, and rolls back if it fails.
import fs from 'node:fs';
import path from 'node:path';
import pkg from '../../../package.json';

export const dynamic = 'force-dynamic';

function release() {
  try {
    return fs.readFileSync(path.join(process.cwd(), 'RELEASE'), 'utf8').trim();
  } catch {
    return null;
  }
}

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  let db = 'demo';
  if (url) {
    try {
      const res = await fetch(`${url}/auth/v1/health`, {
        headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '' },
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      });
      db = res.ok ? 'ok' : `error ${res.status}`;
    } catch {
      db = 'unreachable';
    }
  }
  const ok = db === 'ok' || db === 'demo';
  return Response.json(
    { ok, version: pkg.version, release: release(), db, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
