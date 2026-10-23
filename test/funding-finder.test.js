import test from 'node:test';
import assert from 'node:assert/strict';
import { queriesFor, toWatchPayload, fundingDeadlineHeadsUp, judgeRules, currentRevenue } from '../api/_lib/funding-finder.js';
import { fundingQueries } from '../api/_lib/founder-settings.js';
import { SAMPLE } from './fixtures/founder.js';

test('funding searches rotate by day and fill in the month and year', () => {
  const settings = { ...SAMPLE, funding: { ...SAMPLE.funding, search_queries: Array.from({ length: 24 }, (_, i) => `bakery grant ${i} {month} {year}`) } };
  const a = queriesFor(new Date('2026-10-13T08:30:00Z'), 10, settings);
  const b = queriesFor(new Date('2026-10-14T08:30:00Z'), 10, settings);
  assert.equal(a.length, 10);
  assert.notDeepEqual(a, b);
  assert.ok(a.every((q) => !q.includes('{')));
});

test('without their own searches, the scout builds them from the funding profile', () => {
  const q = fundingQueries(SAMPLE);
  assert.ok(q.some((x) => x.includes('Ohio')));
  assert.ok(q.some((x) => x.includes('women')));
  assert.ok(q.every((x) => !/Maryland|TEDCO|autism/i.test(x)));
});

test('the judge reads the founder profile and region, with nothing about Atara', () => {
  const rules = judgeRules(SAMPLE);
  assert.match(rules, /Northwind Studio LLC/); assert.match(rules, /Ohio and nationwide are fine/);
  assert.doesNotMatch(rules, /Atara|Solei|Maryland|SpectrumThrive/);
  assert.equal(currentRevenue(SAMPLE), 2000);
  assert.equal(currentRevenue({ funding: { revenue: '$12k a year' } }), 12000);
});

test('closed or unclear results are left out', () => {
  const result = { url: 'https://example.org/grant' };
  assert.equal(toWatchPayload({ program_name: 'X', opportunity_type: 'grant', deadline: '2026-10-01' }, result, '2026-10-13'), null);
  assert.equal(toWatchPayload({ program_name: 'X', opportunity_type: 'blog' }, result, '2026-10-13'), null);
  const kept = toWatchPayload({ program_name: 'X Grant', organization: 'Org', opportunity_type: 'grant', deadline: '2026-11-01', fit_label: 'odd' }, result, '2026-10-13');
  assert.equal(kept.fit_label, 'investigate');
  assert.equal(kept.deadline, '2026-11-01');
});

test('deadline reminders come back at each step and keep checkmarks within a step', async () => {
  const saved = [];
  let existing = null;
  const opp = { id: 'p1', title: 'Grant', organization: 'Org', deadline_at: '2026-10-16T16:00:00Z', prep_start_at: '2026-10-02', status: 'reviewing', source_url: 'https://x.org', application_requirements_json: { checklist: ['Short form'] } };
  const chain = (table) => {
    const q = { select() { return q; }, in() { return q; }, is() { return q; }, gte() { return q; }, eq() { return q; }, order() { return q; }, lte() { return q; },
      maybeSingle: async () => ({ data: existing, error: null }),
      upsert: async (row) => { saved.push(row); return { error: null }; },
      then(resolve) { resolve(table === 'crm_program_opportunities' ? { data: [opp], error: null } : { data: [], error: null }); } };
    return q;
  };
  const db = { from: chain };
  const first = await fundingDeadlineHeadsUp(db, { now: new Date('2026-10-13T12:00:00Z') });
  assert.equal(first.reminders, 1);
  assert.equal(saved[0].source_updated, 'step-due-3');
  assert.match(saved[0].title, /Due in 3 days/);
  assert.doesNotMatch(saved[0].heads_up, /\$/, 'no money on Today');
  assert.equal(saved[0].prep[0].text, 'Short form');
  assert.equal(saved[0].acknowledged_at, null);
  existing = { id: 'h1', source_updated: 'step-due-3' };
  const again = await fundingDeadlineHeadsUp(db, { now: new Date('2026-10-13T15:00:00Z') });
  assert.equal(again.reminders, 0);
  assert.equal('prep' in saved[1], false);
});

test('start-by and decide-by steps come before the deadline steps', async () => {
  const { fundingStep } = await import('../api/_lib/funding-finder.js');
  const p = { deadline_at: '2026-12-16T16:00:00Z', prep_start_at: '2026-11-01', status: 'reviewing' };
  assert.equal(fundingStep(p, '2026-10-20'), null);
  assert.equal(fundingStep(p, '2026-10-30').key, 'decide');
  assert.equal(fundingStep(p, '2026-11-01').key, 'start');
  assert.equal(fundingStep(p, '2026-12-02').key, 'due-14');
  assert.equal(fundingStep({ ...p, status: 'apply' }, '2026-10-30'), null, 'a chosen program skips the decide step');
});

test('Scout keeps only real program pages', async () => {
  const { looksLikeProgramPage } = await import('../api/_lib/funding-finder.js');
  assert.equal(looksLikeProgramPage('https://visionaries.co/wp-content/uploads/2026/06/photo.png'), false);
  assert.equal(looksLikeProgramPage('https://x.org/logo.JPG?v=2'), false);
  assert.equal(looksLikeProgramPage('https://x.org/wp-content/uploads/rules.pdf'), true);
  assert.equal(looksLikeProgramPage('https://x.org/grant'), true);
});

test('a program page with a fee or nonprofit-only rule is skipped', async () => {
  const { checkProgramPage } = await import('../api/_lib/funding-finder.js');
  const fetchImpl = async () => ({ ok: true, url: 'https://x.org/grant', headers: { get: () => 'text/html' }, text: async () => '<p>Apply</p>' });
  const fee = await checkProgramPage('https://x.org/grant', { fetchImpl, today: '2026-10-21', ai: async () => JSON.stringify({ application_fee: '$15' }) });
  assert.equal(fee.skip, 'application_fee');
  const np = await checkProgramPage('https://x.org/grant', { fetchImpl, today: '2026-10-21', ai: async () => JSON.stringify({ application_fee: 'none', nonprofit_only: true }) });
  assert.equal(np.skip, 'nonprofit_only');
  const ok = await checkProgramPage('https://x.org/grant', { fetchImpl, today: '2026-10-21', ai: async () => JSON.stringify({ application_fee: 'none', requirements: ['Form'] }) });
  assert.equal(ok.ok, true);
  const img = await checkProgramPage('https://x.org/a', { fetchImpl: async () => ({ ok: true, headers: { get: () => 'image/png' } }), today: '2026-10-21', ai: async () => '{}' });
  assert.equal(img.skip, 'not_a_page');
});

test('morning and afternoon runs search different queries', async () => {
  const { queriesFor } = await import('../api/_lib/funding-finder.js');
  const settings = { funding: { search_queries: Array.from({ length: 30 }, (_, i) => `grant ${i}`) } };
  const am = queriesFor(new Date('2026-10-21T08:30:00Z'), 12, settings);
  const pm = queriesFor(new Date('2026-10-21T17:30:00Z'), 12, settings);
  assert.notDeepEqual(am, pm);
});

test('funding search uses Serper first when its key is set', async () => {
  const { fundingSearch } = await import('../api/_lib/google-search.js');
  const calls = [];
  const out = await fundingSearch({ query: 'x' }, { env: { SERPER_API_KEY: 'k', TAVILY_API_KEY: 't' }, serper: async () => { calls.push('serper'); return [{ url: 'https://a.org' }]; }, tavily: async () => { calls.push('tavily'); return []; } });
  assert.deepEqual(calls, ['serper']);
  assert.equal(out.length, 1);
});

test('a program that already closed is saved to watch for its next round', async () => {
  const { quickAddFunding } = await import('../api/_lib/funding-finder.js');
  const updates = []; let inserted = null;
  const db = { from: () => ({
    select() { return this; }, limit: async () => ({ data: [], error: null }),
    insert(row) { inserted = row; return { select: () => ({ single: async () => ({ data: { id: 'n1', ...row }, error: null }) }) }; },
    update(v) { updates.push(v); return { eq: async () => ({ error: null }) }; },
  }) };
  const ai = async () => JSON.stringify({ program_name: 'Amber Grant', organization: 'WomensNet', official_url: 'https://ambergrantsforwomen.com', opportunity_type: 'grant', amount_text: '$10,000 monthly', round_status: 'closed', deadline: '2026-09-30', next_open: '2026-11-01', cycle_note: 'Runs every month.', fit_label: 'high' });
  const r = await quickAddFunding(db, 'heard about the amber grant', { now: new Date('2026-10-13T12:00:00Z'), search: async () => [{ url: 'https://ambergrantsforwomen.com', title: 'Amber Grant' }], ai, fetchImpl: async () => ({ ok: false }) });
  assert.equal(r.watching, true);
  assert.equal(inserted.deadline_at, null);
  assert.equal(updates[0].status, 'watching');
  assert.equal(updates[0].next_open_at, '2026-11-01');
});
