import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { estimateApplicationEffort, findOpportunityMatch, ingestFundingWatch, normalizeIdentity, normalizeUrl } from '../api/_lib/funding-watch.js';

const watchPayload = {
  program_name: 'NSF SBIR/STTR Phase I', organization: 'U.S. National Science Foundation',
  official_url: 'https://www.nsf.gov/program/?utm_source=watch', opportunity_type: 'grant',
  funding_value_text: 'Up to $305,000', fit_label: 'very_high', effort_level: 'major',
};

function fakeDb(records = []) {
  const calls = [];
  const db = { calls };
  db.from = (table) => {
    calls.push(table);
    const query = { select: () => query, limit: () => Promise.resolve({ data: records }), insert: (row) => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'new-id', ...row } }) }) }), update: (row) => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: records[0]?.id || 'existing-id', ...records[0], ...row } }) }) }) }) };
    return query;
  };
  return db;
}

test('watch ingestion creates an Option without application or Work item', async () => {
  const db = fakeDb();
  const result = await ingestFundingWatch(watchPayload, db);
  assert.equal(result.status, 'created');
  assert.equal(result.opportunity.funding_intent, 'option');
  assert.equal(result.opportunity.status, 'discovered');
  assert.ok(db.calls.every((table) => table === 'crm_program_opportunities'));
});

test('watch ingestion deduplicates URL and preserves chosen lifecycle state', async () => {
  const existing = { id: 'one', title: 'NSF SBIR/STTR Phase I', organization: 'U.S. National Science Foundation', source_url: 'https://www.nsf.gov/program/', funding_intent: 'chosen', status: 'apply', notes: 'keep this', strategic_fit_score: 90 };
  const db = fakeDb([existing]);
  const result = await ingestFundingWatch({ ...watchPayload, funding_value_text: 'Up to $1.25M' }, db);
  assert.equal(result.status, 'updated');
  assert.equal(result.preserved.funding_intent, 'chosen');
  assert.equal(result.preserved.status, 'apply');
  assert.equal(result.opportunity.notes, 'keep this');
  assert.equal(result.opportunity.strategic_fit_score, 90);
});

test('watch re-ingestion preserves an explicitly dismissed opportunity', async () => {
  const existing = { id: 'dismissed', title: 'Harford Workforce Training', organization: 'Harford County', source_url: 'https://example.gov/harford', funding_intent: null, status: 'archived', dismissed_by_user: true, dismissed_reason: 'Not eligible' };
  const result = await ingestFundingWatch({ ...watchPayload, program_name: existing.title, organization: existing.organization, official_url: existing.source_url }, fakeDb([existing]));
  assert.equal(result.status, 'updated');
  assert.equal(result.preserved.status, 'archived');
  assert.equal(result.preserved.funding_intent, null);
});

test('normalized name and funder provide a second dedupe key', () => {
  assert.equal(normalizeIdentity('NSF SBIR/STTR Phase I'), 'nsf sbir sttr phase i');
  assert.equal(findOpportunityMatch([{ title: 'NSF SBIR/STTR Phase I', organization: 'U.S. National Science Foundation' }], { title: 'NSF SBIR STTR Phase I', organization: 'U.S. National Science Foundation', source_url: null }) !== null, true);
  assert.equal(normalizeUrl('https://EXAMPLE.gov/path/?utm_campaign=x'), 'https://example.gov/path');
});

test('watch payload rejects low fit and never accepts chosen intent', async () => {
  const db = fakeDb();
  const skipped = await ingestFundingWatch({ ...watchPayload, fit_label: 'low' }, db);
  assert.equal(skipped.reason, 'low_fit');
  await assert.rejects(() => ingestFundingWatch({ ...watchPayload, funding_intent: 'chosen' }, db), /Only|chosen|invalid/i);
});

test('effort is derived from verified requirements and reusable materials', () => {
  const federal = estimateApplicationEffort({ technical_narrative: true, research_strategy: true, budget: true, registrations: true, commercialization_plan: true }, 'high');
  const short = estimateApplicationEffort({ narrative_questions: true, pitch_deck: true }, 'high');
  assert.equal(federal.effort_level, 'major');
  assert.ok(federal.effort_max_hours >= 20);
  assert.ok(short.effort_max_hours < federal.effort_max_hours);
  assert.equal(estimateApplicationEffort({}), null);
});

test('watch endpoint is authenticated and has one shared ingestion boundary', () => {
  const endpoint = fs.readFileSync(new URL('../api/opportunities/watch.js', import.meta.url), 'utf8');
  assert.match(endpoint, /withCommandAuth/);
  assert.doesNotMatch(endpoint, /command_applications|work_items/);
  const programs = fs.readFileSync(new URL('../api/opportunities/programs.js', import.meta.url), 'utf8');
  assert.match(programs, /external_program_id/);
});

test('watch updates do not write dismissal or lifecycle fields', () => {
  const source = fs.readFileSync(new URL('../api/_lib/funding-watch.js', import.meta.url), 'utf8');
  assert.match(source, /\['funding_intent', 'status', 'title', 'notes'\]/);
  assert.doesNotMatch(source, /dismissed_reason.*UPDATE_FIELDS/);
});
