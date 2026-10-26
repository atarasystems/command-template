import assert from 'node:assert/strict';
import test from 'node:test';
import cardExtract, { CARD_PROMPT, cardFields } from '../api/_routes/crm/card-extract.js';
import { createCommandSession } from '../api/_routes/_lib/auth.js';
import contacts from '../api/_routes/crm/contacts.js';
import fs from 'node:fs';

function response() { return { headers: {}, statusCode: 200, payload: null, setHeader(n, v) { this.headers[n.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, json(v) { this.payload = v; return this; }, end() {} }; }
const cookie = () => `atara_command_session=${createCommandSession()}`;
const image = 'data:image/png;base64,' + 'A'.repeat(32);

test.before(() => { process.env.COMMAND_SESSION_SECRET = 'pass-4g-test-secret-at-least-thirty-two-characters'; });
test.after(() => { delete process.env.COMMAND_SESSION_SECRET; delete process.env.OPENAI_API_KEY; delete process.env.GEMINI_API_KEY; });

test('Pass 4G schema and UI expose only approved contact context fields', () => {
  const api = fs.readFileSync(new URL('../api/_routes/crm/contacts.js', import.meta.url), 'utf8');
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const schema = fs.readFileSync(new URL('../supabase/schema/command-schema.sql', import.meta.url), 'utf8');
  for (const field of ['areas', 'interest', 'capture_status']) assert.match(api, new RegExp(field));
  assert.match(api, /website:\s*value\s*=>\s*optionalText\(value, 'website'/);
  assert.match(api, /contact_status:\s*value\s*=>\s*enumValue/);
  assert.match(schema, /  website text,/);
  assert.match(schema, /contact_status text not null default 'new'::text/);
  assert.match(schema, /contact_status = ANY \(ARRAY\['new'::text, 'follow_up_needed'::text, 'done'::text, 'not_needed'::text\]\)/);
  for (const label of ['Add Person', 'Area(s)', 'What are they interested in?', 'Relationship type', 'Save as unfinished and finish later', 'Finish These Contacts', 'Business Card', 'Website', 'Consulting', 'Partnership', 'data-brand-checkboxes', 'contactStatus']) assert.match(html, new RegExp(label.replace(/[()]/g, '\\$&')));
  assert.match(html, /captureStatus:\s*.*'unfinished'/);
  assert.match(html, /cmdPersistPass4GContext/);
  assert.match(html, /cmd-ac-website/);
  assert.match(html, /cmd-edit-website/);
  assert.match(html, /cmd-ac-status-btns/);
  assert.match(html, /cmd-edit-status-btns/);
  assert.match(html, /data-val="follow_up_needed"/);
  assert.doesNotMatch(html, /cmd-ac-product|cmd-edit-product|cmd-scan-product/);
  assert.match(html, /website:\s*payload\.website \|\| null/);
  assert.doesNotMatch(html, /sendNTMY|cmd-ac-send-ntmy/);
});

test('Add Person exposes phone-first card and manual choices without creating a CRM record', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="cmd-ac-capture-choices"/);
  assert.match(html, /Take \/ Scan Business Card/);
  assert.match(html, /onclick="openPanel\('cmd-card-scan-panel'\)"/);
  assert.match(html, /Add Manually/);
  assert.match(html, /onclick="cmdChooseManualAdd\(\)"/);
  assert.match(html, /id="cmd-card-scan-input2" accept="image\/\*" capture="environment"/);
  assert.match(html, /cmdProcessCardImage\(this\)/);
  assert.match(html, /id="cmd-ac-manual-form" style="display:none;"/);
  assert.match(html, /cmdChooseManualAdd\(\);/);
  assert.match(html, /Nothing will be saved until you press Save Person/);
  assert.match(html, /cmdSubmitAddContact\(\)/);
  assert.doesNotMatch(html, /cmdProcessCardImage[\s\S]{0,500}cmdSubmitAddContact/);
});

test('business-card extraction request asks for visible fields only and never saves CRM data', () => {
  assert.match(CARD_PROMPT, /only information visibly printed/i);
  assert.equal(CARD_PROMPT.includes('/api/crm/contacts'), false);
  assert.deepEqual(cardFields({ name: ' Ada ', phone: '', extra: 'x' }), { name: 'Ada' });
});

test('business-card extraction fails safely when no AI key is added', async () => {
  delete process.env.OPENAI_API_KEY; delete process.env.GEMINI_API_KEY;
  const res = response();
  await cardExtract({ method: 'POST', body: { image_data: image }, headers: { cookie: cookie() } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.payload.error.code, 'AI_NOT_CONFIGURED');
});

test('business-card extraction requires auth and validates image input', async () => {
  process.env.OPENAI_API_KEY = 'test-key';
  const unauthenticated = response();
  await cardExtract({ method: 'POST', body: { image_data: image }, headers: {} }, unauthenticated);
  assert.equal(unauthenticated.statusCode, 401);
  const invalid = response();
  await cardExtract({ method: 'POST', body: { image_data: 'not-an-image' }, headers: { cookie: cookie() } }, invalid);
  assert.equal(invalid.statusCode, 400);
});

test('business-card extraction reads the card with Gemini and returns reviewed fields', async () => {
  delete process.env.OPENAI_API_KEY; process.env.GEMINI_API_KEY = 'test-key';
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, async json() { return { candidates: [{ content: { parts: [{ text: JSON.stringify({ name: 'Ada Lovelace', company: 'Analytical Engines', title: 'Mathematician', email: '', phone: '', website: '' }) }] } }] }; } };
  };
  try {
    const res = response();
    await cardExtract({ method: 'POST', body: { image_data: image }, headers: { cookie: cookie() } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload.data.fields, { name: 'Ada Lovelace', company: 'Analytical Engines', title: 'Mathematician' });
    assert.match(request.url, /generativelanguage\.googleapis\.com/);
    assert.equal(request.options.headers['x-goog-api-key'], 'test-key');
    assert.equal(JSON.parse(request.options.body).contents[0].parts[0].inlineData.mimeType, 'image/png');
  } finally { global.fetch = originalFetch; }
});

test('contact API remains session protected for Pass 4G fields', async () => {
  const res = response();
  await contacts({ method: 'POST', body: { full_name: 'Test Person', areas: ['Atara'], interest: 'networking', capture_status: 'unfinished' }, headers: {} }, res);
  assert.equal(res.statusCode, 401);
});
