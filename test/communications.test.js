import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import handler from '../api/ai/communications.js';
import {
  buildCommunicationContext,
  createCommunicationPrompt,
  draftTypeForPurpose,
  generateCommunicationDraft,
  parseCommunicationResponse,
} from '../api/_lib/communications.js';
import { createCommandSession } from '../api/_lib/auth.js';
import { SAMPLE } from './fixtures/founder.js';

const sessionSecret = 'communications-test-secret-at-least-thirty-two-characters';
function response() { return { statusCode: 200, payload: null, status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; } }; }

test.beforeEach(() => { process.env.COMMAND_SESSION_SECRET = sessionSecret; });
test.after(() => { delete process.env.COMMAND_SESSION_SECRET; });

test('communication preparation rejects unauthenticated requests before database or AI access', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('unexpected downstream call'); };
  try {
    const res = response();
    await handler({ method: 'POST', body: { contact_id: '00000000-0000-0000-0000-000000000001', purpose: 'relationship' }, headers: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('unsupported purposes are refused before any lookup', async () => {
  const res = response();
  await handler({ method: 'POST', body: { contact_id: '00000000-0000-0000-0000-000000000001', purpose: 'seo_geo_prospect' }, headers: { cookie: `atara_command_session=${createCommandSession()}` } }, res);
  assert.equal(res.statusCode, 400);
});

test('communication context is bounded and contains only supplied CRM facts', () => {
  const context = buildCommunicationContext({
    purpose: 'outreach',
    opportunity: { website: 'https://example.com', research_notes: 'Research', personalization_angle: 'Grounded angle' },
    account: { name: 'Example Business' },
    contact: { full_name: 'Alex Example', email: 'alex@example.com', job_title: 'Owner', linkedin_url: 'javascript:alert(1)', notes: 'Relationship note' },
    activities: Array.from({ length: 9 }, (_, i) => ({ activity_type: 'note', subject: `Known ${i}` })),
  });
  assert.equal(context.account, 'Example Business');
  assert.equal(context.contact_first_name, 'Alex');
  assert.equal(context.linkedin_url, null, 'unsafe links are dropped');
  assert.equal(context.recent_activity.length, 6);
  assert.doesNotMatch(JSON.stringify(context), /SUPABASE_SERVICE_ROLE_KEY|API_KEY/);
});

test('the prompt uses the founder from setup, forbids invention and has no Atara sales copy', () => {
  const prompt = createCommunicationPrompt(buildCommunicationContext({ purpose: 'follow_up', contact: { first_name: 'Dana' } }), SAMPLE);
  assert.match(prompt, /Write one email for Maya to review/);
  assert.match(prompt, /Northwind Orders/);
  assert.match(prompt, /Never invent/);
  assert.match(prompt, /must begin exactly with "Hi Dana,"/i);
  assert.match(prompt, /sign-off: Maya/);
  assert.doesNotMatch(prompt, /Solei|Atara|SCOPE|SpectrumThrive|\$49/);
});

test('drafts are validated and style checked before use', () => {
  const draft = parseCommunicationResponse(JSON.stringify({ subject: 'Quick idea', body: 'Hi Dana,\n\nShort note.', do_not_claim: ['results'], grounding_note: 'CRM notes' }));
  assert.equal(draft.subject, 'Quick idea');
  assert.throws(() => parseCommunicationResponse(JSON.stringify({ subject: 'x', body: 'I wanted to reach out about this.' })), /Email style check failed/);
  assert.throws(() => parseCommunicationResponse(JSON.stringify({ subject: '', body: '' })), /missing required text/);
});

test('generation runs through the shared AI helper and never sends email', async () => {
  let seen;
  const ai = async (args) => { seen = args; return '{"subject":"Hello","body":"Hi Dana,\\n\\nGood to meet you.","do_not_claim":[],"grounding_note":"notes"}'; };
  const draft = await generateCommunicationDraft(buildCommunicationContext({ purpose: 'relationship', contact: { first_name: 'Dana' } }), { settings: SAMPLE, ai });
  assert.equal(draft.subject, 'Hello');
  assert.equal(seen.tier, 'write');
  assert.match(seen.user, /Maya/);
});

test('communication route creates a reviewable draft and never sends', () => {
  const source = fs.readFileSync(new URL('../api/ai/communications.js', import.meta.url), 'utf8');
  assert.match(source, /insertRow\('crm_email_drafts'/);
  assert.match(source, /status: 'needs_review'/);
  assert.match(source, /needs_human: true/);
  assert.doesNotMatch(source, /sendGmailMessage|send-email|crm_opportunities.*update|\.rpc\(|openai/i);
  assert.equal(draftTypeForPurpose('outreach'), 'sales');
  assert.equal(draftTypeForPurpose('partner'), 'networking');
  assert.equal(draftTypeForPurpose('follow_up'), 'follow_up');
});
