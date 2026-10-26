import assert from 'node:assert/strict';
import test from 'node:test';
import projectsHandler from '../api/_routes/work/projects.js';
import phasesHandler from '../api/_routes/work/phases.js';
import itemsHandler from '../api/_routes/work/items.js';
import todayHandler from '../api/_routes/work/today.js';
import programsHandler from '../api/_routes/opportunities/programs.js';
import intelligenceHandler from '../api/_routes/gmail/intelligence.js';
import messageHandler from '../api/_routes/gmail/message.js';
import actionHandler, { actionPlan } from '../api/_routes/gmail/action.js';
import weeklyReviewHandler from '../api/_routes/gmail/weekly-review.js';
import aiTeamHandler from '../api/_routes/ai/team.js';
import { chooseOpportunityMatch, classifyEmail, inferDecisionStatus } from '../api/_routes/gmail/intelligence.js';
import { findOrCreateLabel, modifyMessageLabels, trashMessage, listMessagesByLabel, WEEKLY_REVIEW_LABEL } from '../api/_routes/_lib/gmail.js';
import { createCommandSession } from '../api/_routes/_lib/auth.js';
import { hasInitializedSupabaseClient } from '../api/_routes/_lib/supabase.js';
import { applicationWorkValues, dueDateValue, isActionable, normalizeItemInput, todayRank } from '../api/_routes/_lib/work.js';
import { AI_EMPLOYEES, handoffPacket, summarizeAiTeam, validateAiAssignment } from '../api/_routes/_lib/ai-team.js';
import fs from 'node:fs';

function response() { return { statusCode: 200, payload: null, status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; } }; }

test('all Work, opportunity, and Gmail intelligence APIs reject unauthenticated requests before initialization', async () => {
  assert.equal(hasInitializedSupabaseClient(), false);
  for (const handler of [projectsHandler, phasesHandler, itemsHandler, todayHandler, programsHandler, intelligenceHandler, messageHandler, actionHandler, weeklyReviewHandler, aiTeamHandler]) {
    const res = response(); await handler({ method: 'GET', query: {}, headers: {} }, res);
    assert.equal(res.statusCode, 401); assert.equal(res.payload.error.code, 'UNAUTHORIZED');
  }
  assert.equal(hasInitializedSupabaseClient(), false);
});

test('AI Team registry is six functional employees with truthful execution modes', () => {
  assert.deepEqual(AI_EMPLOYEES.map((employee) => employee.key), ['revenue_scout', 'business_development', 'grant_scout', 'follow_up', 'client_success', 'ceo_briefing']);
  assert.equal(AI_EMPLOYEES.find((employee) => employee.key === 'revenue_scout').execution_mode, 'External workflow');
  assert.equal(AI_EMPLOYEES.find((employee) => employee.key === 'business_development').execution_mode, 'Command-assisted');
  assert.equal(AI_EMPLOYEES.find((employee) => employee.key === 'ceo_briefing').execution_mode, 'Command-assisted');
  assert.equal(AI_EMPLOYEES.filter((employee) => employee.execution_mode === 'Manual handoff').length, 3);
  assert.equal(AI_EMPLOYEES.some((employee) => Object.hasOwn(employee, 'online')), false);
});

test('AI Work assignment validates named agents and preserves item context', () => {
  assert.equal(validateAiAssignment({ owner_type: 'ai', assigned_agent: 'revenue_scout' }), null);
  assert.match(validateAiAssignment({ owner_type: 'ai', assigned_agent: 'unknown_executor' }), /supported AI employee/);
  assert.match(validateAiAssignment({ owner_type: 'founder', assigned_agent: 'grant_scout' }), /requires owner_type ai/);
  const returned = normalizeItemInput({ owner_type: 'founder', assigned_agent: 'grant_scout', project_id: 'project-1', category: 'grant', priority: 'next', status: 'open' });
  assert.equal(returned.assigned_agent, null);
  const packet = handoffPacket({ assigned_agent: 'grant_scout', title: 'Review SBIR fit', project_name: 'Pilot R&D', priority: 'next', notes: 'Use the current eligibility notes.', source_type: 'program_opportunity', source_id: 'opportunity-1', status: 'open' });
  assert.match(packet, /Employee: Grant Scout/); assert.match(packet, /Project: Pilot R&D/); assert.doesNotMatch(packet, /undefined|SUPABASE|TOKEN|SECRET/);
  assert.equal(packet.includes('Due:'), false);
});

test('AI Team summary counts real work states without execution claims', () => {
  const summary = summarizeAiTeam([
    { owner_type: 'ai', assigned_agent: 'revenue_scout', status: 'open' },
    { owner_type: 'ai', assigned_agent: 'grant_scout', status: 'in_progress' },
    { owner_type: 'ai', assigned_agent: 'grant_scout', status: 'waiting' },
    { owner_type: 'founder', status: 'open' },
    { owner_type: 'ai', assigned_agent: 'follow_up', status: 'done' },
  ]);
  assert.deepEqual({ assigned_to_ai_count: summary.assigned_to_ai_count, in_progress_count: summary.in_progress_count, waiting_count: summary.waiting_count, needs_founder_count: summary.needs_founder_count }, { assigned_to_ai_count: 3, in_progress_count: 1, waiting_count: 1, needs_founder_count: 0 });
  assert.equal(summary.employees.find((employee) => employee.key === 'grant_scout').in_progress_count, 1);
});

test('AI Team UI exposes shared-work handoffs without autonomous controls', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const name of ['Revenue Scout', 'Business Development', 'Grant Scout', 'Follow-Up Agent', 'Client Success', 'CEO Briefing']) assert.match(html, new RegExp(name));
  assert.match(html, /id="panel-ai-team"/);
  assert.match(html, /Copy Handoff/);
  assert.match(html, /Return to me/);
  assert.match(html, /Assign to AI/);
  assert.doesNotMatch(html, /Run Agent|start-ai|execute-agent|autonomous-task/);
  assert.doesNotMatch(html, /AI Employee Quick Launch|const EMPLOYEES =/);
  assert.match(html, /value="ai:revenue_scout"/);
  assert.match(html, /value="ai:ceo_briefing"/);
});

test('Gmail action validation rejects unsafe or incomplete requests before OAuth', async () => {
  const oldSecret = process.env.COMMAND_SESSION_SECRET; process.env.COMMAND_SESSION_SECRET = 'pass-32-character-test-session-secret';
  const cookie = `atara_command_session=${createCommandSession()}`;
  for (const body of [{ action: 'archive' }, { action: 'permanent_delete', gmail_message_id: 'm1' }, { action: 'trash', gmail_message_id: 'm1' }]) {
    const res = response(); await actionHandler({ method: 'POST', body, headers: { cookie } }, res); assert.equal(res.statusCode, 400);
  }
  if (oldSecret) process.env.COMMAND_SESSION_SECRET = oldSecret; else delete process.env.COMMAND_SESSION_SECRET;
});

test('Gmail cleanup label resolution reuses and creates idempotently', async () => {
  const originalFetch = global.fetch; let creates = 0; const queue = [
    { ok: true, json: async () => ({ labels: [{ id: 'Label_1', name: 'Command Cleanup' }] }) },
    { ok: true, json: async () => ({ labels: [] }) },
    { ok: true, json: async () => ({ id: 'Label_2', name: 'Command Cleanup' }) },
    { ok: true, json: async () => ({ labels: [{ id: 'Label_2', name: 'Command Cleanup' }] }) },
  ];
  global.fetch = async (url, options) => { if (options?.method === 'POST') creates += 1; return queue.shift(); };
  try { assert.equal((await findOrCreateLabel('token')).id, 'Label_1'); assert.equal((await findOrCreateLabel('token')).id, 'Label_2'); assert.equal((await findOrCreateLabel('token')).id, 'Label_2'); assert.equal(creates, 1); } finally { global.fetch = originalFetch; }
});

test('Weekly Review label support is explicit, idempotent, and lists recoverable messages', async () => {
  assert.equal(WEEKLY_REVIEW_LABEL, 'Command / Weekly Review');
  const originalFetch = global.fetch; const calls = [];
  global.fetch = async (url, options) => { calls.push({ url, options }); if (url.includes('/messages?labelIds=')) return { ok: true, json: async () => ({ messages: [{ id: 'm1' }] }) }; return { ok: true, json: async () => ({ id: 'm1', threadId: 't1', snippet: 'Filed for review', payload: { headers: [{ name: 'From', value: 'Apple <news@apple.example>' }, { name: 'Subject', value: 'Announcement' }, { name: 'Date', value: 'Wed, 26 Aug 2026 12:00:00 +0000' }] }, labelIds: ['Label_weekly'] }) }; };
  try { const messages = await listMessagesByLabel('token', 'Label_weekly'); assert.equal(messages[0].message_id, 'm1'); } finally { global.fetch = originalFetch; }
  assert.match(calls[0].url, /labelIds=Label_weekly/); assert.equal(calls.some((call) => call.options?.method === 'DELETE'), false);
});

test('Weekly Review rejects unsafe actions before Gmail configuration or mutation', async () => {
  const oldSecret = process.env.COMMAND_SESSION_SECRET; process.env.COMMAND_SESSION_SECRET = 'pass-32-character-test-session-secret';
  const cookie = `atara_command_session=${createCommandSession()}`;
  for (const body of [{ action: 'delete', gmail_message_id: 'm1' }, { action: 'spam', gmail_message_id: 'm1' }, { action: 'restore' }]) {
    const res = response(); await weeklyReviewHandler({ method: 'POST', body, headers: { cookie } }, res); assert.equal(res.statusCode, 400);
  }
  if (oldSecret) process.env.COMMAND_SESSION_SECRET = oldSecret; else delete process.env.COMMAND_SESSION_SECRET;
});

test('Gmail message mutations use narrow reversible label/trash operations only', async () => {
  const originalFetch = global.fetch; const calls = [];
  global.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ id: 'm1', labelIds: ['INBOX'] }) }; };
  try { await modifyMessageLabels('token', 'm1', { removeLabelIds: ['INBOX'] }); await trashMessage('token', 'm1'); } finally { global.fetch = originalFetch; }
  assert.match(calls[0].url, /messages\/m1\/modify$/); assert.deepEqual(JSON.parse(calls[0].options.body), { addLabelIds: [], removeLabelIds: ['INBOX'] }); assert.match(calls[1].url, /messages\/m1\/trash$/); assert.equal(calls.some((call) => /delete/.test(call.url)), false);
});

test('Gmail action plans preserve unrelated labels', () => {
  assert.deepEqual(actionPlan('archive'), { removeLabelIds: ['INBOX'] });
  assert.deepEqual(actionPlan('cleanup', 'Label_cleanup'), { addLabelIds: ['Label_cleanup'], removeLabelIds: ['INBOX'] });
  assert.deepEqual(actionPlan('mark_read'), { removeLabelIds: ['UNREAD'] });
  assert.deepEqual(actionPlan('mark_unread'), { addLabelIds: ['UNREAD'] });
  assert.deepEqual(actionPlan('restore_inbox'), { operation: 'restore_inbox' });
});

test('Today engine keeps future deferred work out and ranks overdue first', () => {
  const now = new Date('2026-08-26T12:00:00Z');
  const overdue = { status: 'open', due_at: '2026-08-25T12:00:00Z' };
  const normal = { status: 'open', priority: 'normal' };
  const deferred = { status: 'open', defer_until: '2026-08-27T12:00:00Z' };
  assert.equal(isActionable(deferred, now), false);
  assert.equal(todayRank(overdue, now)[0] < todayRank(normal, now)[0], true);
  assert.equal(isActionable({ status: 'done' }, now), false);
  assert.equal(isActionable({ status: 'cancelled' }, now), false);
});

test('Work input clears completed_at when a done item reopens', () => {
  for (const status of ['open', 'in_progress', 'waiting']) assert.equal(normalizeItemInput({ status, completed_at: '2026-08-25T12:00:00Z' }).completed_at, null);
});

test('date-only due dates represent the full selected day', () => {
  assert.equal(dueDateValue('2026-08-30'), '2026-08-31T03:59:59.999Z');
  assert.equal(dueDateValue('2026-12-30'), '2026-12-31T04:59:59.999Z');
  assert.equal(dueDateValue('2026-08-30T10:00:00Z'), '2026-08-30T10:00:00Z');
});

test('program application work sync values follow title and deadline', () => {
  assert.deepEqual(applicationWorkValues({ title: 'Cohort application', deadline_at: '2026-08-31T03:59:59.999Z' }), { title: 'Complete Cohort application', due_at: '2026-08-31T03:59:59.999Z' });
});

test('important no-reply messages classify independently of sender mailbox', () => {
  assert.equal(classifyEmail({ sender: { email: 'noreply@program.org' }, subject: 'Your application has been received', snippet: '' }).classification, 'application_update');
  assert.equal(classifyEmail({ sender: { email: 'noreply@accelerator.org' }, subject: 'You have been selected for an interview', snippet: '' }).classification, 'decision_result');
  assert.equal(classifyEmail({ sender: { email: 'noreply@grantportal.org' }, subject: 'Applications are now open', snippet: '' }).classification, 'grant_program_opportunity');
  assert.notEqual(classifyEmail({ sender: { email: 'info@business.org' }, subject: 'Re: your website project', snippet: 'Can you send the proposal?' }).classification, 'administrative');
  assert.equal(classifyEmail({ sender: { email: 'noreply@system.org' }, subject: 'Receipt for your payment', snippet: '' }).classification, 'administrative');
});

test('decision inference is conservative', () => {
  assert.equal(inferDecisionStatus('Congratulations', ''), null);
  assert.equal(inferDecisionStatus('You are a finalist', ''), 'final_decision');
  assert.equal(inferDecisionStatus('Semi-finalist update', ''), 'final_decision');
  assert.equal(inferDecisionStatus('Selected for an interview', ''), 'interview');
  assert.equal(inferDecisionStatus('You were not selected', ''), 'not_selected');
  assert.equal(inferDecisionStatus('Awarded funding', ''), 'awarded');
});

test('program matching requires strong unique evidence and never uses contact recency', () => {
  const message = { subject: 'Thank you for your City Fund SBIR application', snippet: 'Your application has been received.' };
  const opportunities = [{ id: 'a', title: 'City Fund SBIR', organization: 'City Fund', status: 'in_progress' }, { id: 'b', title: 'City Fund Founder Fellowship', organization: 'City Fund', status: 'reviewing' }];
  assert.equal(chooseOpportunityMatch(message, opportunities).opportunity_id, 'a');
  const ambiguous = [{ id: 'a', title: 'Cohort application', organization: 'Program One', status: 'in_progress' }, { id: 'b', title: 'Cohort application', organization: 'Program Two', status: 'reviewing' }];
  const result = chooseOpportunityMatch({ subject: 'Cohort application update', snippet: '' }, ambiguous);
  assert.equal(result.opportunity_id, null);
  assert.deepEqual(result.candidate_ids, ['a', 'b']);
});

test('ambiguous matches remain unlinked for human selection', () => {
  const result = chooseOpportunityMatch({ subject: 'Application update', snippet: 'Your cohort program application needs attention.' }, [
    { id: 'a', title: 'Cohort Program', organization: 'One Org', status: 'in_progress' },
    { id: 'b', title: 'Cohort Program', organization: 'Two Org', status: 'in_progress' },
  ]);
  assert.equal(result.opportunity_id, null);
  assert.deepEqual(result.candidate_ids, ['a', 'b']);
});

test('program work sync does not imply overwriting completed work', () => {
  const values = applicationWorkValues({ title: 'Updated program', deadline_at: '2026-12-31T04:59:59.999Z' });
  assert.equal(values.title, 'Complete Updated program');
  assert.equal(values.due_at, '2026-12-31T04:59:59.999Z');
});

test('opportunity creation is a form action, not a browser prompt', async () => {
  const html = await (await import('node:fs/promises')).readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal(html.includes("prompt('Opportunity title')"), false);
});

