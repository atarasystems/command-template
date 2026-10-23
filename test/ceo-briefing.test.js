import assert from 'node:assert/strict';
import test from 'node:test';

import handler from '../api/ai/ceo-briefing.js';
import { createBriefingPrompt, buildBriefingContext, generateBriefing } from '../api/_lib/ceo-briefing.js';
import { createCommandSession } from '../api/_lib/auth.js';
import { AI_EMPLOYEES } from '../api/_lib/ai-team.js';
import fs from 'node:fs';

const sessionSecret = 'test-session-secret-with-at-least-thirty-two-characters';

function response() {
  return {
    statusCode: 200,
    payload: undefined,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
  };
}

test.beforeEach(() => { process.env.COMMAND_SESSION_SECRET = sessionSecret; });
test.after(() => { delete process.env.COMMAND_SESSION_SECRET; });

test('CEO Briefing rejects unauthenticated requests before data or Anthropic access', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; throw new Error('unexpected downstream call'); };
  try {
    const res = response();
    await handler({ method: 'POST', body: {}, headers: {} }, res);
    assert.equal(res.statusCode, 401);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('CEO Briefing context is compact and excludes secrets and full email content', () => {
  const context = buildBriefingContext({
    work: [{ title: 'Review launch plan', status: 'open', priority: 'now', due_at: '2026-08-30T03:59:59.999Z', owner_type: 'ai', assigned_agent: 'ceo_briefing', notes: 'Use the current launch notes.' }],
    sales: [{ stage: 'qualified', offer_type: 'audit', opportunity_value: 147, next_action: 'Prepare follow-up', account: { name: 'North Star' } }],
    programs: [{ title: 'SBIR', organization: 'Agency', status: 'reviewing', deadline_at: '2026-09-01T03:59:59.999Z' }],
    audits: [{ audit_type: 'seo_geo', status: 'pending', created_at: '2026-08-26T12:00:00Z', partner: { company_name: 'North Star' } }],
  });
  const prompt = createBriefingPrompt(context);
  assert.match(prompt, /Review launch plan/);
  assert.match(prompt, /SBIR/);
  assert.match(prompt, /North Star/);
  for (const forbidden of ['SUPABASE_SERVICE_ROLE_KEY', 'ANTHROPIC_API_KEY', 'partner_token', 'Stripe', 'OAuth', 'full email body']) assert.equal(prompt.includes(forbidden), false);
  assert.equal(context.work[0].context, 'Use the current launch notes.');
});

test('CEO Briefing includes a server-side reference time and temporal guardrails', () => {
  const context = buildBriefingContext({ programs: [{ title: 'Summer event', deadline_at: '2026-08-25T16:00:00.000Z' }] }, new Date('2026-08-27T15:00:00.000Z'));
  const prompt = createBriefingPrompt(context);
  assert.equal(context.current_datetime, '2026-08-27T15:00:00.000Z');
  assert.match(prompt, /current_datetime is the current date\/time/);
  assert.match(prompt, /upcoming or approaching/);
  assert.match(prompt, /potentially stale or overdue/);
  assert.match(prompt, /Summer event/);
});

test('CEO Briefing does not force three priorities or invent relevance and team state', () => {
  const prompt = createBriefingPrompt(buildBriefingContext());
  assert.match(prompt, /up to three actual justified priorities/);
  assert.match(prompt, /Never manufacture an additional item/);
  assert.match(prompt, /Do not recommend pursuing a grant/);
  assert.match(prompt, /An announcement, article, event, or discovery Work Item is not automatically an active Program Opportunity/);
  assert.match(prompt, /owner = founder means the founder owns that Work Item/);
  assert.match(prompt, /It does not mean an AI employee is waiting, blocked/);
  assert.match(prompt, /owner = ai and assigned_agent identifies that employee/);
  assert.match(prompt, /Separate facts from suggestions/);
  assert.match(prompt, /If no current sales opportunities/);
});

test('CEO Briefing remains read-only and uses only the canonical employee registry', () => {
  const source = fs.readFileSync(new URL('../api/ai/ceo-briefing.js', import.meta.url), 'utf8');
  for (const mutation of ['.insert(', '.update(', '.delete(', '.rpc(']) assert.equal(source.includes(mutation), false);
  assert.deepEqual(AI_EMPLOYEES.map((employee) => employee.key), ['revenue_scout', 'business_development', 'grant_scout', 'follow_up', 'client_success', 'ceo_briefing']);
  assert.equal(AI_EMPLOYEES.find((employee) => employee.key === 'ceo_briefing').execution_mode, 'Command-assisted');
});

test('CEO Briefing UI exposes preparation and safe copy controls without agent execution', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /Prepare Briefing/);
  assert.match(html, /Copy Briefing/);
  assert.match(html, /\/api\/ai\/ceo-briefing/);
  assert.doesNotMatch(html, /Run Agent|execute-agent|autonomous-task/);
});

test('CEO Briefing sends compact context to mocked Anthropic and returns plain text', async () => {
  const calls = [];
  const context = buildBriefingContext({ work: [{ title: 'Review the current work', status: 'open', priority: 'now' }] });
  const briefing = await generateBriefing(context, {
    apiKey: 'test-anthropic-key',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ content: [{ type: 'text', text: "TODAY'S TOP 3\n1. Review the current work." }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
  assert.match(briefing, /TODAY'S TOP 3/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.anthropic.com/v1/messages');
  const providerBody = JSON.parse(calls[0].options.body);
  assert.match(providerBody.system, /Review the current work/);
  assert.equal(providerBody.system.includes('test-service-role-key'), false);
});
