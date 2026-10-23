import test from 'node:test';
import assert from 'node:assert/strict';
import { moneyScore, provisionalScores, fundingGroup, defaultLeadDays, prepStartFor } from '../api/_lib/funding-scores.js';
import { prepItemsFor, kitState } from '../api/_lib/funding-prep.js';

test('money bands and groups', () => {
  assert.equal(moneyScore(5000), 20);
  assert.equal(moneyScore(25000), 60);
  assert.equal(moneyScore(305000), 100);
  assert.equal(fundingGroup({ funding_value_score: 80, realism_score: 80 }), 'Do first');
  assert.equal(fundingGroup({ funding_value_score: 100, realism_score: 40 }), 'Big long shot');
  assert.equal(fundingGroup({ funding_value_score: 40, realism_score: 60 }), 'Quick win');
  assert.equal(fundingGroup({ funding_value_score: 20, realism_score: 40 }), 'Low priority');
});

test('provisional scores never overwrite her own', () => {
  const s = provisionalScores({ funding_max_amount: 100000, fit_label: 'high', realism_score: 82, is_non_dilutive: true }, { likelihood: 2, today: '2026-10-21' });
  assert.equal(s.funding_value_score, 80);
  assert.equal(s.strategic_fit_score, 75);
  assert.equal('realism_score' in s, false);
  assert.equal(s.dilution_cost_score, 100);
});

test('lead time and start-by date', () => {
  assert.equal(defaultLeadDays({ title: 'NSF SBIR Phase I' }), 45);
  assert.equal(defaultLeadDays({ opportunity_type: 'accelerator' }), 14);
  assert.equal(prepStartFor({ deadline_at: '2026-12-16', lead_time_days: 45 }), '2026-11-01');
});

test('prep list puts registrations first and writing near the deadline', () => {
  const items = prepItemsFor({ id: 'x', deadline_at: '2026-12-16', prep_start_at: '2026-11-01', application_requirements_json: { checklist: ['Grants.gov organization registration', 'Project narrative', 'Letters of support'] } }, '2026-10-21');
  assert.equal(items[0].kind, 'registration');
  assert.equal(items[0].kit_key, 'grants_gov');
  assert.equal(items[0].due_at, '2026-11-01');
  assert.equal(items[1].kind, 'writing');
  assert.equal(items[1].due_at, '2026-12-13');
  assert.equal(items[2].kind, 'letter');
});

test('Ready Kit item turns refresh due when it is old', () => {
  assert.equal(kitState({ status: 'ready', last_updated_at: '2026-10-01', refresh_days: 7 }, new Date('2026-10-21')), 'needs_refresh');
  assert.equal(kitState({ status: 'ready', last_updated_at: '2026-10-20', refresh_days: 7 }, new Date('2026-10-21')), 'ready');
  assert.equal(kitState({ status: 'not_started' }), 'not_started');
});
