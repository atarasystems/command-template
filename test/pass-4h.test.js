import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import labelsHandler from '../api/_routes/gmail/labels.js';
import { ensureRelationshipLabels, modifyThreadLabels, RELATIONSHIP_GMAIL_LABELS } from '../api/_routes/_lib/gmail.js';

function response() { return { statusCode: 200, payload: null, status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; } }; }
import { isWaitingOnThem, matchGmailInsightToContact, relationshipModes, relationshipQueueRank, relationshipStage } from '../api/_routes/_lib/relationships.js';

const contact = (overrides = {}) => ({ id: 'c1', email: 'person@example.com', relationshipType: 'network', areas: [], interest: 'networking', contactStatus: 'new', captureStatus: 'complete', ...overrides });

test('relationship work modes reuse one existing contact without a second contact store', () => {
  const row = contact({ relationshipType: 'client', interest: 'partnership' });
  assert.deepEqual(relationshipModes(row), ['clients', 'partners']);
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /Relationship Desk/);
  assert.doesNotMatch(html, /CREATE TABLE[^]*relationship_contacts/i);
});

test('relationship queue prioritizes unfinished, overdue, due-soon, then explicit follow-up', () => {
  const now = new Date('2026-08-27T12:00:00Z');
  assert.equal(relationshipQueueRank(contact({ captureStatus: 'unfinished' }), now), 0);
  assert.equal(relationshipQueueRank(contact({ followupDueDate: '2026-08-26' }), now), 1);
  assert.equal(relationshipQueueRank(contact({ followupDueDate: '2026-08-29' }), now), 2);
  assert.equal(relationshipQueueRank(contact({ contactStatus: 'follow_up_needed' }), now), 3);
  assert.equal(relationshipQueueRank(contact({ notes: 'Waiting on their reply' }), now), 4);
  assert.equal(relationshipQueueRank(contact({ followupIntent: 'Reply after conference' }), now), 4);
});

test('relationship stages are conservative and never use capture_status', () => {
  assert.equal(relationshipStage(contact()), 'New');
  assert.equal(relationshipStage(contact({ contactStatus: 'follow_up_needed' })), 'Building');
  assert.equal(relationshipStage(contact({ contactStatus: 'follow_up_needed', notes: 'Waiting on their reply' })), 'Waiting');
  assert.equal(relationshipStage(contact({ relationshipType: 'client', contactStatus: 'done' })), 'Strong');
  assert.equal(relationshipStage(contact({ contactStatus: 'done', followupIntent: 'Reconnect in Q4' })), 'Reconnect');
  assert.equal(relationshipStage(contact({ captureStatus: 'unfinished', contactStatus: 'new' })), 'New');
});

test('Gmail relationship matching requires contact id or exact email', () => {
  const row = contact();
  assert.equal(matchGmailInsightToContact({ contact_id: 'c1', sender_email: 'other@example.com' }, row), true);
  assert.equal(matchGmailInsightToContact({ sender_email: 'PERSON@example.com' }, row), true);
  assert.equal(matchGmailInsightToContact({ sender_email: 'person@other.example' }, row), false);
  assert.equal(matchGmailInsightToContact({ sender_email: 'unknown@example.com' }, contact({ email: '' })), false);
  assert.equal(isWaitingOnThem(contact({ notes: 'Awaiting their response' })), true);
});

test('Pass 4H follow-up remains human-controlled and does not add automatic send behavior', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /Prepare Follow-Up/);
  assert.match(html, /prepare_reply/);
  assert.match(html, /needs_human/);
  assert.doesNotMatch(html, /fetch\([^)]*\/api\/send-email[^)]*\)[\s\S]{0,500}Prepare Follow-Up/);
});

test('Gmail relationship taxonomy is exact and human-controlled in the UI', () => {
  assert.deepEqual(RELATIONSHIP_GMAIL_LABELS, ['Command / Prospecting', 'Command / Networking', 'Command / Clients', 'Command / Partners', 'Command / Programs + Grants']);
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const label of RELATIONSHIP_GMAIL_LABELS) assert.match(html, new RegExp(label.replace(/[+]/g, '\\+')));
  assert.match(html, /ensureRelationshipGmailLabels/);
  assert.match(html, /applyRelationshipGmailLabel/);
  assert.match(html, /thread_id/);
  assert.doesNotMatch(html, /applyRelationshipGmailLabel[\s\S]{0,1200}contact_status/);
});

test('Gmail relationship labels reuse exact existing labels and create only missing labels', async () => {
  const originalFetch = global.fetch; const created = [];
  global.fetch = async (url, options) => {
    if (url.endsWith('/labels') && options?.method === 'POST') { const body = JSON.parse(options.body); created.push(body.name); return { ok: true, json: async () => ({ id: 'new-' + created.length, name: body.name }) }; }
    if (url.endsWith('/labels')) return { ok: true, json: async () => ({ labels: RELATIONSHIP_GMAIL_LABELS.slice(0, 4).map((name, index) => ({ id: 'existing-' + index, name })) }) };
    throw new Error('unexpected Gmail request');
  };
  try { const labels = await ensureRelationshipLabels('token'); assert.equal(labels.length, 5); assert.deepEqual(created, ['Command / Programs + Grants']); } finally { global.fetch = originalFetch; }
});

test('Gmail relationship label ensure is idempotent when all exact labels exist', async () => {
  const originalFetch = global.fetch; let creates = 0;
  global.fetch = async (url, options) => { if (options?.method === 'POST') creates += 1; return { ok: true, json: async () => ({ labels: RELATIONSHIP_GMAIL_LABELS.map((name, index) => ({ id: 'label-' + index, name })) }) }; };
  try { assert.equal((await ensureRelationshipLabels('token')).length, 5); assert.equal(creates, 0); } finally { global.fetch = originalFetch; }
});

test('Gmail relationship labels apply to a thread without removing unrelated labels', async () => {
  const originalFetch = global.fetch; let call;
  global.fetch = async (url, options) => { call = { url, options }; return { ok: true, json: async () => ({ id: 'thread-1' }) }; };
  try { await modifyThreadLabels('token', 'thread-1', { addLabelIds: ['Label_1'] }); } finally { global.fetch = originalFetch; }
  assert.match(call.url, /threads\/thread-1\/modify$/); assert.deepEqual(JSON.parse(call.options.body), { addLabelIds: ['Label_1'], removeLabelIds: [] });
});

test('Gmail label route rejects unauthenticated and unconfigured requests safely', async () => {
  const old = { id: process.env.GMAIL_CLIENT_ID, secret: process.env.GMAIL_CLIENT_SECRET, refresh: process.env.GMAIL_REFRESH_TOKEN };
  delete process.env.GMAIL_CLIENT_ID; delete process.env.GMAIL_CLIENT_SECRET; delete process.env.GMAIL_REFRESH_TOKEN;
  try { const res = response(); await labelsHandler({ method: 'POST', body: { action: 'ensure' }, headers: {} }, res); assert.equal(res.statusCode, 401); } finally { if (old.id) process.env.GMAIL_CLIENT_ID = old.id; if (old.secret) process.env.GMAIL_CLIENT_SECRET = old.secret; if (old.refresh) process.env.GMAIL_REFRESH_TOKEN = old.refresh; }
});
