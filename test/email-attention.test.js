import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { ensureWork } from '../api/gmail/intelligence.js';

function attention() {
  const context = { Intl, Date, Map, Set, Number, String, Boolean, Array, isNaN, globalThis: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../email-attention.js', import.meta.url), 'utf8'), context);
  return context.globalThis.AtaraEmailAttention;
}

const now = new Date('2026-09-02T16:00:00-04:00');

test('email attention derives all five buckets conservatively', () => {
  const a = attention();
  assert.equal(a.classify({ sender_name: 'Dana Lee, Program Officer', sender_email: 'dlee@cityfund.example', classification: 'client', subject: 'Next step for your application', snippet: 'Please sign in and complete the next step.' }, { now }).bucket, 'ACTION_REQUIRED');
  assert.equal(a.classify({ sender_name: 'City Fund', sender_email: 'grants@cityfund.example', classification: 'decision_result', subject: 'Your application was approved', snippet: 'You now have access to the program.' }, { now }).bucket, 'IMPORTANT_INFORMATION');
  assert.equal(a.classify({ sender_name: 'Main Street Investor Circle', sender_email: 'updates@investorcircle.example', classification: 'networking', subject: 'Founder research resource', snippet: 'A useful research and education resource.' }, { now }).bucket, 'USEFUL_LATER');
  assert.equal(a.classify({ sender_name: 'Apple', sender_email: 'news@insideapple.apple.com', classification: 'sales', subject: 'Introducing a new product', snippet: 'Read the announcement.' }, { now }).bucket, 'WEEKLY_REVIEW');
  assert.equal(a.classify({ sender_name: 'Groupon Local', sender_email: 'noreply@r.groupon.com', classification: 'networking', subject: 'Daily deals near you', snippet: 'Coupons and discounts.' }, { now }).bucket, 'NOISE');
});

test('known sender context overrides promotional-looking words', () => {
  const a = attention();
  const result = a.classify({ sender_name: 'Dana Lee, Program Officer', sender_email: 'dlee@cityfund.example', classification: 'client', subject: 'Your pitch materials', snippet: 'The funder review says the investment story needs a clearer distinction.' }, { now });
  assert.equal(result.bucket, 'IMPORTANT_INFORMATION');
  assert.equal(a.isProtectedContext({ sender_email: 'grants@cityfund.example', sender_name: 'City Fund grant officer' }), true);
});

test('pending status alone never creates action and Weekly Review or Useful Later never create Work', async () => {
  const db = { from() { throw new Error('database should not be reached'); } };
  const message = { message_id: 'm1', sender: { name: 'Apple', email: 'news@apple.example' }, subject: 'Product announcement', snippet: 'Introducing a new product.', received_at: '2026-08-27T12:00:00Z' };
  assert.equal(await ensureWork(db, message, 'sales', {}), null);
  const research = { message_id: 'm2', sender: { name: 'Research', email: 'research@example.org' }, subject: 'Neurodivergent AI research', snippet: 'A research resource for later.', received_at: '2026-08-27T12:00:00Z' };
  assert.equal(await ensureWork(db, research, 'networking', {}), null);
});

test('relative dates resolve against received_at and stale dates do not become current', () => {
  const a = attention();
  assert.equal(a.easternDate(a.dateContext({ received_at: '2026-08-25T14:24:17Z', subject: '3 events happening tomorrow', snippet: '' }).date), '2026-08-26');
  assert.equal(a.easternDate(a.dateContext({ received_at: '2026-08-27T14:01:20Z', subject: '1 event happening tomorrow', snippet: '' }).date), '2026-08-28');
  assert.equal(a.classify({ sender_email: 'noreply@skool.example', classification: 'grant_program_opportunity', received_at: '2026-08-25T14:24:17Z', subject: '3 events happening tomorrow', snippet: '' }, { now }).bucket, 'WEEKLY_REVIEW');
});

test('structured dates win over stale email language and current supported deadlines remain actionable', () => {
  const a = attention();
  const structured = a.dateContext({ received_at: '2026-08-25T14:00:00Z', deadline_at: '2026-09-08T16:00:00-04:00', subject: 'Deadline tomorrow', snippet: '' });
  assert.equal(structured.kind, 'structured');
  assert.equal(a.classify({ sender_name: 'Program Officer', sender_email: 'officer@funder.example', classification: 'grant_program_opportunity', deadline_at: '2026-09-08T16:00:00-04:00', subject: 'Application deadline', snippet: 'Please review and respond.' }, { now }).bucket, 'ACTION_REQUIRED');
  assert.equal(a.classify({ sender_email: 'noreply@example.org', classification: 'sales', received_at: '2026-08-27T12:00:00Z', subject: 'Deadline', snippet: 'The deadline was yesterday.' }, { now }).bucket, 'USEFUL_LATER');
});
