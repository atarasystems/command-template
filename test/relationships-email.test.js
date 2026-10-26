import assert from 'node:assert/strict';
import test from 'node:test';
import gmailScan from '../api/_routes/gmail-scan.js';
import sendEmail from '../api/_routes/send-email.js';
import roles from '../api/_routes/crm/contact-roles.js';
import emailDrafts from '../api/_routes/crm/email-drafts.js';
import { createCommandSession } from '../api/_routes/_lib/auth.js';

function response() { return { headers: {}, statusCode: 200, payload: null, setHeader(n,v){this.headers[n.toLowerCase()]=v;}, status(c){this.statusCode=c;return this;}, json(v){this.payload=v;return this;}, end(){return this;} }; }
const cookie = () => `atara_command_session=${createCommandSession()}`;

test.before(() => { process.env.COMMAND_SESSION_SECRET = 'relationship-test-secret-at-least-thirty-two-characters'; });
test.after(() => { delete process.env.COMMAND_SESSION_SECRET; });

test('Gmail endpoints reject unauthenticated requests before OAuth initialization', async () => {
  delete process.env.GMAIL_CLIENT_ID; delete process.env.GMAIL_CLIENT_SECRET; delete process.env.GMAIL_REFRESH_TOKEN;
  for (const handler of [gmailScan, sendEmail]) {
    const res = response(); await handler({ method: 'POST', body: {}, headers: {} }, res);
    assert.equal(res.statusCode, 401);
  }
});

test('authenticated Gmail requests reach configuration guard without calling Gmail', async () => {
  delete process.env.GMAIL_CLIENT_ID; delete process.env.GMAIL_CLIENT_SECRET; delete process.env.GMAIL_REFRESH_TOKEN;
  for (const handler of [gmailScan, sendEmail]) {
    const res = response(); await handler({ method: 'POST', body: {}, headers: { cookie: cookie() } }, res);
    assert.equal(res.statusCode, 500);
  }
});

test('role and email draft endpoints are server-session protected', async () => {
  for (const handler of [roles, emailDrafts]) {
    const res = response(); await handler({ method: 'GET', query: {}, headers: {} }, res);
    assert.equal(res.statusCode, 401);
  }
});
