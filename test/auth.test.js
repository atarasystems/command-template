import assert from 'node:assert/strict';
import test from 'node:test';

import { createCommandSession, verifyCommandSession, withCommandAuth } from '../api/_lib/auth.js';
import { hasInitializedSupabaseClient } from '../api/_lib/supabase.js';
import loginHandler from '../api/auth/login.js';
import logoutHandler from '../api/auth/logout.js';
import accountsHandler from '../api/crm/accounts.js';

function response() {
  return {
    headers: {},
    statusCode: 200,
    payload: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
  };
}

function cookieFrom(setCookie) {
  return setCookie.split(';', 1)[0];
}

const password = 'test-command-password';
const secret = 'test-session-secret-with-at-least-thirty-two-characters';

test.beforeEach(() => {
  process.env.COMMAND_PASSWORD = password;
  process.env.COMMAND_SESSION_SECRET = secret;
});

test.after(() => {
  delete process.env.COMMAND_PASSWORD;
  delete process.env.COMMAND_SESSION_SECRET;
});

test('unauthenticated CRM request returns 401 without initializing Supabase', async () => {
  assert.equal(hasInitializedSupabaseClient(), false);
  const res = response();
  await accountsHandler({ method: 'GET', query: {}, headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.error.code, 'UNAUTHORIZED');
  assert.equal(hasInitializedSupabaseClient(), false);
});

test('auth guard never invokes the protected handler for an unauthenticated request', async () => {
  let invoked = false;
  const protectedHandler = withCommandAuth(async () => { invoked = true; });
  const res = response();
  await protectedHandler({ headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(invoked, false);
});

test('correct Command password creates a valid hardened session cookie', () => {
  const originalVercel = process.env.VERCEL;
  process.env.VERCEL = '1';
  const res = response();
  loginHandler({ method: 'POST', body: { password }, headers: {} }, res);
  if (originalVercel) process.env.VERCEL = originalVercel;
  else delete process.env.VERCEL;
  assert.equal(res.statusCode, 200);
  const setCookie = res.headers['set-cookie'];
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.match(setCookie, /Path=\//);
  const req = { headers: { cookie: cookieFrom(setCookie) } };
  assert.equal(verifyCommandSession(req), true);
});

test('incorrect password is rejected generically', () => {
  const res = response();
  loginHandler({ method: 'POST', body: { password: 'incorrect' }, headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.payload, {
    ok: false,
    error: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
  });
  assert.equal(res.headers['set-cookie'], undefined);
});

test('tampered session cookie is rejected', async () => {
  const token = createCommandSession();
  const res = response();
  await accountsHandler({
    method: 'GET',
    query: {},
    headers: { cookie: `atara_command_session=${token.slice(0, -1)}x` },
  }, res);
  assert.equal(res.statusCode, 401);
});

test('valid session permits the protected handler to proceed', async () => {
  let invoked = false;
  const protectedHandler = withCommandAuth(async (_req, res) => {
    invoked = true;
    return res.status(204).json(null);
  });
  const token = createCommandSession();
  const res = response();
  await protectedHandler({ headers: { cookie: `atara_command_session=${token}` } }, res);
  assert.equal(invoked, true);
  assert.equal(res.statusCode, 204);
});

test('logout clears the signed session cookie', () => {
  const res = response();
  logoutHandler({ method: 'POST', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['set-cookie'], /Max-Age=0/);
  assert.match(res.headers['set-cookie'], /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
  assert.equal(verifyCommandSession({ headers: { cookie: cookieFrom(res.headers['set-cookie']) } }), false);
});
