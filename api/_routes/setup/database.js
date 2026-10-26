// First run: Command builds its own tables in the founder's new Supabase database.
// GET tells the setup screen whether the tables exist. POST creates them (safe to run again).
import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { withCommandAuth } from '../_lib/auth.js';
import { allowMethods, sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';

export const maxDuration = 60;
export const SCHEMA_FILE = path.join(process.cwd(), 'supabase', 'schema', 'command-schema.sql');

// The Vercel Supabase connection adds these. SUPABASE_DB_URL is for anyone connecting a database by hand.
export function databaseUrl(env = process.env) {
  return env.POSTGRES_URL_NON_POOLING || env.SUPABASE_DB_URL || env.POSTGRES_URL || '';
}

// Which outside connections are in place. Only yes or no ever leaves the server, never a key itself.
export function keyStatus(env = process.env) {
  const has = (...names) => names.every((n) => Boolean(env[n]));
  return {
    password: has('COMMAND_PASSWORD'),
    session_secret: has('COMMAND_SESSION_SECRET'),
    cron_secret: has('CRON_SECRET'),
    gemini: has('GEMINI_API_KEY'),
    google: has('GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN') || has('GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN'),
    serper: has('SERPER_API_KEY'),
    resend: has('RESEND_API_KEY'),
  };
}

export async function schemaReady(db) {
  try {
    const row = await db.from('command_notes').select('body').eq('note_key', 'schema_version').maybeSingle();
    if (row.error) return false;
    return Boolean(row.data?.body);
  } catch { return false; }
}

export async function createTables({ url = databaseUrl(), sql = null, Client = pg.Client } = {}) {
  if (!url) throw Object.assign(new Error('Command cannot reach the database yet. Connect Supabase to this project in Vercel (Storage tab), then redeploy.'), { code: 'NO_DATABASE_URL', status: 503 });
  const schema = sql ?? await fs.readFile(SCHEMA_FILE, 'utf8');
  const client = new Client({ connectionString: url, ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(schema);
    // Tell Supabase's API to see the new tables right away.
    await client.query("notify pgrst, 'reload schema'").catch(() => {});
  } finally {
    await client.end().catch(() => {});
  }
  return { created: true };
}

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) return;
  try {
    let db = null;
    try { db = getSupabase(); } catch { db = null; }
    if (req.method === 'GET') {
      return sendData(res, { database_connected: Boolean(db), can_create: Boolean(databaseUrl()), ready: db ? await schemaReady(db) : false, keys: keyStatus() });
    }
    if (db && await schemaReady(db)) return sendData(res, { ready: true, created: false });
    await createTables();
    return sendData(res, { ready: true, created: true });
  } catch (error) {
    console.error('[Setup database]', error?.message || error);
    return sendError(res, { code: error.code || 'SETUP_FAILED', message: error.message || 'The tables could not be created.', safeMessage: error.message }, error.status || 500);
  }
}

export default withCommandAuth(handler);
