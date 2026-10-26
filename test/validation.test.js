import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEAD_SOURCES, OFFERS, PIPELINES, QUALIFICATION_GRADES, TRIGGERS, dateValue, domainFromWebsite, emailValue, enumValue,
  moneyValue, pickDefined,
} from '../api/_routes/_lib/validation.js';

test('normalizes a website into a duplicate-check domain', () => {
  assert.equal(domainFromWebsite('https://www.Example.com/path'), 'example.com');
  assert.equal(domainFromWebsite('example.com'), 'example.com');
});

test('normalizes email and rejects malformed email', () => {
  assert.equal(emailValue(' Maya@Example.COM ', false), 'maya@example.com');
  assert.throws(() => emailValue('not-an-email', false), /valid/);
});

test('validates pipeline, source and money bounds', () => {
  assert.equal(enumValue('partner', 'pipeline', PIPELINES), 'partner');
  assert.equal(enumValue('google_ads', 'lead_source', LEAD_SOURCES), 'google_ads');
  assert.equal(moneyValue('1250.499', 'opportunity_value'), 1250.5);
  assert.throws(() => enumValue('enterprise', 'pipeline', PIPELINES), /must be one of/);
  assert.throws(() => moneyValue(-1, 'opportunity_value'), /positive amount/);
});

test('validates Scout qualification grades and announcement dates', () => {
  assert.equal(enumValue('A', 'qualification_grade', QUALIFICATION_GRADES), 'A');
  assert.equal(enumValue('C', 'qualification_grade', QUALIFICATION_GRADES), 'C');
  assert.equal(dateValue('2026-08-26', 'announcement_date'), '2026-08-26');
  assert.throws(() => enumValue('D', 'qualification_grade', QUALIFICATION_GRADES), /must be one of/);
  assert.throws(() => dateValue('2026-02-30', 'announcement_date'), /valid date/);
});

test('accepts referral-partner taxonomy without conflating Alignable', () => {
  assert.equal(enumValue('referral_partner_research', 'lead_source', LEAD_SOURCES), 'referral_partner_research');
  assert.equal(enumValue('referral_partner_fit', 'trigger_type', TRIGGERS), 'referral_partner_fit');
  assert.equal(enumValue('referral_partnership', 'offer_type', OFFERS), 'referral_partnership');
  assert.equal(enumValue('alignable', 'lead_source', LEAD_SOURCES), 'alignable');
  assert.equal(enumValue('alignable_relationship', 'trigger_type', TRIGGERS), 'alignable_relationship');
});

test('only permits schema-defined update fields', () => {
  const values = pickDefined({ name: ' Atara ', unexpected: 'secret' }, {
    name: value => value.trim(),
  });
  assert.deepEqual(values, { name: 'Atara' });
});
