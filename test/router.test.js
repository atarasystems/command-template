import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ROUTES, routeFor } from '../api/router.js';
import { sendError } from '../api/_routes/_lib/http.js';

function fakeRes() { const r = { code: 200, body: null, headers: {} }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.setHeader = (k, v) => { r.headers[k] = v; }; return r; }

test('one server function serves every Command address', () => {
  const files = [];
  (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) { if (e.name !== '_lib') walk(p); } else if (p.endsWith('.js')) files.push(p); } })('api/_routes');
  assert.equal(Object.keys(ROUTES).length, files.length, 'every route file is in the router');
  const fns = fs.readdirSync('api').filter((f) => f.endsWith('.js'));
  assert.deepEqual(fns, ['router.js'], 'only one function, well under the free plan limit of 12');
  const v = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  assert.equal(v.rewrites[0].destination, '/api/router?__route=:path');
  for (const c of v.crons) assert.ok(ROUTES[c.path.replace('/api/', '')], c.path);
});

test('the router finds the route from the rewrite or the address', () => {
  assert.equal(routeFor({ query: { __route: 'ai/message-help' } }), 'ai/message-help');
  assert.equal(routeFor({ url: '/api/know?deck=pitch', query: {} }), 'know');
  assert.ok(ROUTES.know && ROUTES['setup/database'] && ROUTES.settings);
});

test('unknown addresses get a plain 404', async () => {
  const { default: handler } = await import('../api/router.js');
  const res = fakeRes();
  await handler({ query: { __route: 'nope' }, url: '/api/nope' }, res);
  assert.equal(res.code, 404);
});

test('errors Command raises on purpose keep their plain message', () => {
  const res = fakeRes();
  sendError(res, Object.assign(new Error('The AI is busy right now.'), { status: 502 }));
  assert.equal(res.code, 502);
  assert.equal(res.body.error.message, 'The AI is busy right now.');
  const hidden = fakeRes();
  sendError(hidden, new Error('db password wrong at host x'));
  assert.equal(hidden.code, 500);
  assert.doesNotMatch(hidden.body.error.message, /password/);
});

test('a brand new copy with no tables goes straight to Setup', () => {
  const src = fs.readFileSync('command-settings.js', 'utf8');
  assert.match(src, /checkFirstRun/);
  assert.match(src, /d\.ready === false\) location\.href = '\/setup\.html'/);
});
