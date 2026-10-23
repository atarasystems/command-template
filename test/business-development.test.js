import assert from 'node:assert/strict';
import test from 'node:test';
import { SAMPLE } from './fixtures/founder.js';
import fs from 'node:fs';
import handler from '../api/ai/business-development.js';
import { buildOutreachContext, createOutreachPrompt, generateOutreachPrep, parseOutreachResponse } from '../api/_lib/business-development.js';
import { createCommandSession } from '../api/_lib/auth.js';
import { hasInitializedSupabaseClient } from '../api/_lib/supabase.js';
import { AI_EMPLOYEES } from '../api/_lib/ai-team.js';

const sessionSecret = 'test-session-secret-with-at-least-thirty-two-characters';

function response() {
  return { statusCode: 200, payload: undefined, status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; } };
}

test.beforeEach(() => { process.env.COMMAND_SESSION_SECRET = sessionSecret; });
test.after(() => { delete process.env.COMMAND_SESSION_SECRET; });

test('Business Development rejects unauthenticated requests before Supabase or Anthropic access', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error('unexpected downstream call'); };
  try {
    const res = response();
    await handler({ method: 'POST', body: { opportunity_id: '00000000-0000-0000-0000-000000000001' }, headers: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(fetchCalls, 0);
    assert.equal(hasInitializedSupabaseClient(), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Business Development keeps the canonical execution modes', () => {
  assert.equal(AI_EMPLOYEES.find((employee) => employee.key === 'business_development').execution_mode, 'Command-assisted');
  assert.equal(AI_EMPLOYEES.find((employee) => employee.key === 'ceo_briefing').execution_mode, 'Command-assisted');
  assert.equal(AI_EMPLOYEES.find((employee) => employee.key === 'revenue_scout').execution_mode, 'External workflow');
  for (const key of ['grant_scout', 'follow_up', 'client_success']) assert.equal(AI_EMPLOYEES.find((employee) => employee.key === key).execution_mode, 'Manual handoff');
});

test('Business Development prompt uses supplied CRM facts and founder voice guardrails', () => {
  const context = buildOutreachContext({
    website: 'https://northstar.example',
    stage: 'researching',
    offer_type: 'direct_audit',
    next_action: 'Prepare a low-pressure introduction',
    problem_spotted: 'Recent website relaunch recorded in CRM',
    account: { name: 'North Star Foods' },
    contact: { first_name: 'Claire', last_name: 'Harvey', job_title: 'Marketing Director', email: 'claire@example.com' },
  }, [{ activity_type: 'note', subject: 'Referral introduction', description: 'Referred by a mutual partner', occurred_at: '2026-08-25T12:00:00Z' }]);
  const prompt = createOutreachPrompt(context, { ...SAMPLE, voice: { ...SAMPLE.voice, no_dashes: true } });
  assert.match(prompt, /North Star Foods/);
  assert.match(prompt, /Northwind Orders/);
  assert.doesNotMatch(prompt, /Atara|SCOPE|Solei|\$49/);
  assert.match(prompt, /Claire Harvey/);
  assert.match(prompt, /Recent website relaunch/);
  assert.match(prompt, /Do not invent.*buying signal/s);
  for (const phrase of ['guaranteed results', 'revenue']) assert.match(prompt, new RegExp(phrase, 'i'));
  for (const phrase of ['U+2013', 'U+2014', 'plain, natural American English', 'canned outreach phrases', 'personally typed']) assert.equal(prompt.toLowerCase().includes(phrase.toLowerCase()), true, phrase);
  for (const forbidden of ['SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY', 'partner_token', 'Stripe IDs', 'OAuth credentials']) assert.equal(JSON.stringify(context).includes(forbidden), false);
});

test('Business Development provider receives only bounded prospect context and returns structured prep', async () => {
  const context = buildOutreachContext({ account: { name: 'North Star Foods' }, contact: { full_name: 'Claire Harvey' }, stage: 'researching', website: 'https://northstar.example' });
  const calls = [];
  const prep = await generateOutreachPrep(context, {
    apiKey: 'test-anthropic-key',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ why_this_business: 'The CRM records a current prospect.', best_angle: 'Offer a simple audit overview.', draft_email: 'Hi Claire,\n\nI am writing because North Star is already in our CRM as a current prospect. Want me to send the audit details?', follow_up: 'Hi Claire,\n\nI can send the sample if you want to see what the audit covers.', do_not_claim: ['Do not claim guaranteed rankings.'], optional_next_step: 'Suggestion: review the draft before sending.' }) }] }), { status: 200 });
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  const body = JSON.parse(calls[0].options.body);
  assert.match(body.system, /North Star Foods/);
  assert.equal(body.system.includes('test-anthropic-key'), false);
  assert.equal(body.system.includes('partner_token'), false);
  assert.equal(body.system.includes('Stripe IDs'), false);
  assert.deepEqual(prep.do_not_claim, ['Do not claim guaranteed rankings.']);
  assert.match(prep.draft_email, /Hi Claire/);
});

test('Business Development normalizes long dashes and rejects canned AI outreach language', () => {
  const normalized = parseOutreachResponse(JSON.stringify({ why_this_business: 'Known fit.', best_angle: 'Simple note.', draft_email: 'Hi Alex\u2014I saw the update. Want me to send the sample?', follow_up: 'I can send the details\u2013if you want them.', do_not_claim: [], optional_next_step: 'Review.' }));
  assert.doesNotMatch(`${normalized.draft_email}\n${normalized.follow_up}`, /[\u2013\u2014]/);
  assert.throws(() => parseOutreachResponse(JSON.stringify({ why_this_business: 'Known fit.', best_angle: 'Simple note.', draft_email: 'I wanted to reach out about your agency.', follow_up: 'I can send the details if you want them.', do_not_claim: [], optional_next_step: 'Review.' })), /Email style check failed/);
});

test('Business Development safely rejects malformed provider output', () => {
  assert.throws(() => parseOutreachResponse('<script>alert(1)</script>'), /Unexpected token/);
  assert.throws(() => parseOutreachResponse(JSON.stringify({ why_this_business: 'x' })), /missing required text/);
});

test('Business Development generation path is read-only and isolated from legacy execution', () => {
  const source = fs.readFileSync(new URL('../api/ai/business-development.js', import.meta.url), 'utf8');
  for (const mutation of ['.insert(', '.update(', '.delete(', '.rpc(']) assert.equal(source.includes(mutation), false);
  for (const forbidden of ['river', 'employee-dispatch', 'send-email', 'resend', 'Stripe', 'partner_report_requests', 'credit_redemption', 'slack']) assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false);
});

test('Business Development UI provides preparation and copy controls without send controls', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /Prepare Outreach/);
  assert.match(html, /Copy Email/);
  assert.match(html, /Copy Follow-Up/);
  assert.match(html, /\/api\/ai\/business-development/);
  assert.doesNotMatch(html, /Run Agent/);
});
