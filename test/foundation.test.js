import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import accountsHandler from '../api/_routes/crm/accounts.js';
import { createCommandSession } from '../api/_routes/_lib/auth.js';

test('browser bundle never references server credentials or browser-only auth storage', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const forbidden of [
    'SUPABASE_SERVICE_ROLE_KEY',
    'COMMAND_PASSWORD',
    'COMMAND_SESSION_SECRET',
    'service_role',
    'CONFIG.password',
    'atara_cmd_auth',
  ]) assert.equal(html.includes(forbidden), false, `${forbidden} must not appear in browser code`);
});

test('every Revenue CRM route uses the server-side Command auth guard', async () => {
  const routes = ['accounts', 'activities', 'contacts', 'opportunities', 'suppressions'];
  for (const route of routes) {
    const source = await readFile(new URL(`../api/_routes/crm/${route}.js`, import.meta.url), 'utf8');
    assert.match(source, /export default withCommandAuth\(handler\);/, `${route} must be session-protected`);
  }
});

test('unconfigured API returns the consistent JSON error envelope', async () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const originalSecret = process.env.COMMAND_SESSION_SECRET;
  process.env.COMMAND_SESSION_SECRET = 'test-session-secret-that-is-long-enough';
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  let statusCode;
  let payload;
  const res = {
    setHeader() {},
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return this; },
  };
  const token = createCommandSession();
  await accountsHandler({ method: 'GET', query: {}, headers: { cookie: `atara_command_session=${token}` } }, res);
  assert.equal(statusCode, 500);
  assert.deepEqual(payload, {
    ok: false,
    error: { code: 'CRM_NOT_CONFIGURED', message: 'Revenue CRM database is not configured' },
  });

  if (originalUrl) process.env.SUPABASE_URL = originalUrl;
  if (originalKey) process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  if (originalSecret) process.env.COMMAND_SESSION_SECRET = originalSecret;
  else delete process.env.COMMAND_SESSION_SECRET;
});
