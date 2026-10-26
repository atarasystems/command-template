import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { buildTransactionValues, summarizeFinance } from '../api/_routes/_lib/finance.js';
import { mapRiverAction } from '../api/_routes/_lib/river-actions.js';

const now = new Date('2026-10-07T12:00:00Z');

test('finance stores expenses as negative and income as positive amounts', () => {
  const expense = buildTransactionValues({ txn_date: '2026-10-02', description: 'Vercel', amount: 20.6, txn_type: 'expense' }, now);
  assert.equal(expense.amount, -20.6);
  assert.equal(expense.include_in_opex, true);
  assert.equal(expense.evidence_status, 'missing');
  const income = buildTransactionValues({ txn_date: '2026-10-02', description: 'First SCOPE', amount: -49, txn_type: 'income' }, now);
  assert.equal(income.amount, 49);
  assert.equal(income.include_in_opex, false);
  assert.throws(() => buildTransactionValues({ txn_date: 'Oct 2', description: 'x', amount: 1, txn_type: 'expense' }), /YYYY-MM-DD/);
});

test('finance summary matches the bookkeeping workbook math', () => {
  const months = [
    { month: '2026-07', business_income: 0, business_opex: 261.46, missing_evidence: 2, unreviewed: 9, needs_review: 0 },
    { month: '2026-08', business_income: 0, business_opex: 259.88, missing_evidence: 4, unreviewed: 10, needs_review: 0 },
    { month: '2026-09', business_income: 700, business_opex: 705.76, missing_evidence: 9, unreviewed: 13, needs_review: 0 },
    { month: '2026-10', business_income: 49, business_opex: 20, missing_evidence: 1, unreviewed: 1, needs_review: 0 },
  ];
  const summary = summarizeFinance({ months, transactions: [{ amount: 1000, txn_date: '2026-09-01' }, { amount: -400, txn_date: '2026-09-17' }], settings: { starting_cash: 0 }, recurring: [{ status: 'active', expected_amount: 20, cadence: 'Monthly' }, { status: 'ended', expected_amount: 22, cadence: 'Monthly' }], now });
  assert.deepEqual(summary.burn_months, ['2026-07', '2026-08', '2026-09']);
  assert.equal(summary.monthly_burn, 409.03);
  assert.equal(summary.cash_position, 600);
  assert.equal(summary.cash_as_of, '2026-09-17');
  assert.equal(summary.runway_months, 1.5);
  assert.equal(summary.committed_monthly, 20);
  assert.equal(summary.missing_evidence, 16);
});

test('River money, work, grant, milestone and contact actions map to Supabase tables', () => {
  const money = mapRiverAction('money', { action: 'addTransaction', type: 'Expense', who: 'Namecheap', amount: 18.68, date: '2026-10-03', category: 'Software' }, now);
  assert.equal(money.table, 'command_finance_transactions');
  assert.equal(money.values.amount, -18.68);
  assert.equal(money.values.source, 'river');

  const action = mapRiverAction('command', { action: 'addActionItem', actionItem: 'Send SOW', owner: 'Me', dueDate: '2026-10-09', category: 'Immediate' }, now);
  assert.equal(action.table, 'work_items');
  assert.equal(action.values.owner_type, 'founder');
  assert.equal(action.values.priority, 'now');

  const tickler = mapRiverAction('command', { action: 'addTicklerItem', text: 'Check City Fund reply', date: '2026-10-14' }, now);
  assert.equal(tickler.values.status, 'waiting');
  assert.equal(tickler.values.defer_until, '2026-10-14');

  const applied = mapRiverAction('growth', { action: 'addApplied', name: 'EchoHer Fellowship', type: 'Fellowship', outcome: 'Not Selected' }, now);
  assert.equal(applied.table, 'crm_program_opportunities');
  assert.equal(applied.values.status, 'not_selected');
  assert.equal(applied.values.opportunity_type, 'fellowship');

  const milestone = mapRiverAction('command', { action: 'addMilestone', milestone: 'Cohort 3 opens', date: '2026-11-02' }, now);
  assert.equal(milestone.table, 'command_milestones');

  const contact = mapRiverAction('connect', { action: 'addContact', name: 'Dana Lee', company: 'Baltimore WBC', email: 'Dana@Example.org', followupDueDate: '2026-10-10' }, now);
  assert.equal(contact.kind, 'contact');
  assert.equal(contact.values.email, 'dana@example.org');
  assert.equal(contact.values.contact_status, 'follow_up_needed');

  assert.throws(() => mapRiverAction('money', { action: 'deleteEverything' }), /not supported/);
});

test('River action route writes to Supabase and no longer calls Google Apps Script', () => {
  const route = fs.readFileSync(new URL('../api/_routes/river-action.js', import.meta.url), 'utf8');
  assert.match(route, /runRiverAction/);
  assert.doesNotMatch(route, /script\.google\.com/);
  assert.doesNotMatch(route, /Access-Control-Allow-Origin/);
});

test('Command loads money, milestones and grants from Supabase routes', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /fetch\('\/api\/finance'\)/);
  assert.match(html, /fetch\('\/api\/milestones'\)/);
  assert.doesNotMatch(html, /Famous Amos finalist notification/);
});
