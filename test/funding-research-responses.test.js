import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { researchFundingOpportunity } from '../api/_routes/_lib/funding-research.js';
import { applicationSummaryFromResponse, normalizeResponse } from '../api/_routes/_lib/application-responses.js';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('URL research produces a preview without saving or fabricating unknown fields', async () => {
  const preview = await researchFundingOpportunity({ input: { url: 'https://official.example/program' }, fetchImpl: async () => ({ ok: true, async text() { return '<title>Official Founder Program</title><meta name="description" content="A program page">'; } }) });
  assert.equal(preview.title, 'Official Founder Program');
  assert.equal(preview.source_url, 'https://official.example/program');
  assert.equal(preview.saved, undefined);
  assert.equal(preview.funding_value_text, null);
  assert.equal(preview.fit_label, 'investigate');
});

test('name research uses one bounded search result and remains a preview', async () => {
  const preview = await researchFundingOpportunity({ input: { program_name: 'Founder Fellowship', organization: 'Example Foundation' }, searchImpl: async () => [{ title: 'Founder Fellowship', url: 'https://foundation.example/fellowship', snippet: 'Official program details' }] });
  assert.equal(preview.source_url, 'https://foundation.example/fellowship');
  assert.equal(preview.organization, 'Example Foundation');
  assert.equal(preview.missing.includes('deadline'), true);
});

test('response updates normalize, sort through the API query, and update application summaries', () => {
  const row = normalizeResponse({ application_id: 'app-1', response_date: '2026-09-20', response_type: 'interview', summary: 'Interview requested', action_required: true, next_action: 'Schedule interview', action_due_at: '2026-09-25' });
  const summary = applicationSummaryFromResponse(row, { status: 'submitted' });
  assert.equal(summary.response_status, 'Interview / Pitch');
  assert.equal(summary.status, 'interview');
  assert.equal(summary.next_action, 'Schedule interview');
});

test('research and response routes are authenticated and use existing systems', () => {
  const research = read('api/_routes/opportunities/research.js');
  const responses = read('api/_routes/applications/responses.js');
  const search = read('api/_routes/applications/response-search.js');
  assert.match(research, /withCommandAuth/);
  assert.match(research, /saved: false/);
  assert.match(responses, /withCommandAuth/);
  assert.match(search, /withCommandAuth/);
  assert.doesNotMatch(research, /insert\(|command_applications|work_items/);
});

test('Funding Hub exposes research, responses, and compact attention controls', () => {
  const html = read('applications.html');
  for (const phrase of ['Research Opportunity', 'Research Preview', 'Add Update', 'Responses', 'Needs Attention']) assert.match(html, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('response migration preserves existing applications and stores chronological updates', () => {
  const sql = read('supabase/schema/command-schema.sql');
  assert.match(sql, /create table if not exists public\.command_application_responses/);
  assert.match(sql, /REFERENCES command_applications\(id\)/);
  assert.match(sql, /alter table public\.command_application_responses enable row level security/);
  assert.doesNotMatch(sql, /\bDROP\s+TABLE|\bTRUNCATE\b|\bDELETE\s+FROM/i);
});
