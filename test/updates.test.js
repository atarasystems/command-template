import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { levelsFor, periodFor, previousMonthRef, cleanFollowups, noDashes, gatherForReview, reviewPrompt, writeReview } from '../api/_routes/_lib/updates.js';

function fakeDb(rows) {
  return { from() {
    const filters = [];
    const q = {
      select() { return q; }, is(c, v) { filters.push((r) => (r[c] ?? null) === v); return q; },
      gte(c, v) { filters.push((r) => String(r[c]) >= v); return q; }, lte(c, v) { filters.push((r) => String(r[c]) <= v); return q; },
      in(c, vals) { filters.push((r) => vals.includes(r[c])); return q; }, eq() { return q; }, order() { return q; }, limit() { return q; },
      then(resolve) { resolve({ data: rows.filter((r) => filters.every((f) => f(r))), error: null }); },
    };
    return q;
  } };
}

test('Reviews only see updates cleared for their audience', async () => {
  assert.deepEqual(levelsFor('me'), ['private', 'team', 'investor']);
  assert.deepEqual(levelsFor('team'), ['team', 'investor']);
  assert.deepEqual(levelsFor('investor'), ['investor']);
  const rows = [
    { entry_date: '2026-10-06', body: 'private note', share_level: 'private', deleted_at: null },
    { entry_date: '2026-10-06', body: 'team note', share_level: 'team', deleted_at: null },
    { entry_date: '2026-10-07', body: 'investor note', share_level: 'investor', deleted_at: null },
    { entry_date: '2026-10-07', body: 'deleted investor note', share_level: 'investor', deleted_at: 'x' },
  ];
  const period = { start: '2026-10-05', end: '2026-10-11' };
  const team = await gatherForReview(fakeDb(rows), { audience: 'team', period });
  assert.deepEqual(team.updates.map((u) => u.body), ['team note', 'investor note']);
  assert.deepEqual(team.completedTasks, []);
  const inv = await gatherForReview(fakeDb(rows), { audience: 'investor', period });
  assert.deepEqual(inv.updates.map((u) => u.body), ['investor note']);
});

test('Shared reviews leave out follow-ups even if the writer returns some', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: '{"title":"Week — in review","body":"We shipped SCOPE — live.","followups":[{"title":"Call Tasha","due_date":"2026-10-09"}]}' }] }) });
  const shared = await writeReview({ kind: 'week', audience: 'investor', period: { start: '2026-10-05', end: '2026-10-11' }, updates: [{ entry_date: '2026-10-06', body: 'x' }] }, { apiKey: 'k', fetchImpl });
  assert.deepEqual(shared.followups, []);
  assert.doesNotMatch(shared.title + shared.body, /[—–]/);
  const mine = await writeReview({ kind: 'week', audience: 'me', period: { start: '2026-10-05', end: '2026-10-11' }, updates: [{ entry_date: '2026-10-06', body: 'x' }] }, { apiKey: 'k', fetchImpl });
  assert.equal(mine.followups[0].title, 'Call Tasha');
  assert.match(reviewPrompt({ kind: 'week', audience: 'team', period: { start: '2026-10-05', end: '2026-10-11' } }), /Use only the notes provided/);
});

test('Weeks run Monday to Sunday and months run first to last', () => {
  assert.deepEqual(periodFor('week', '2026-10-07'), { start: '2026-10-05', end: '2026-10-11' });
  assert.deepEqual(periodFor('week', '2026-10-11'), { start: '2026-10-05', end: '2026-10-11' });
  assert.deepEqual(periodFor('month', '2026-02-10'), { start: '2026-02-01', end: '2026-02-28' });
  assert.equal(previousMonthRef('2026-11-01'), '2026-10-01');
  assert.equal(previousMonthRef('2027-01-01'), '2026-12-01');
});

test('Follow-ups are cleaned, capped and never dated in the past', () => {
  const out = cleanFollowups([{ title: 'Email Dana — intro', due_date: '2026-10-01' }, { title: '' }, { title: 'Send deck', due_date: 'soon' }], '2026-10-07');
  assert.equal(out.length, 2);
  assert.equal(out[0].due_date, '2026-10-07');
  assert.equal(out[1].due_date, null);
  assert.doesNotMatch(out[0].title, /—/);
  assert.equal(noDashes('a — b – c -- d'), 'a, b, c, d');
});

test('Updates page is in the menu and reviews run on Fridays and the 1st', () => {
  const shell = fs.readFileSync(new URL('../command-shell.js', import.meta.url), 'utf8');
  const cron = fs.readFileSync(new URL('../api/_routes/cron/reviews.js', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../command-updates.js', import.meta.url), 'utf8');
  const config = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.ok(shell.includes("label: 'Updates'"));
  assert.match(cron, /weekday === 5/);
  assert.match(cron, /endsWith\('-01'\)/);
  assert.match(cron, /audience: 'me'/);
  assert.ok(config.crons.some((c) => c.path === '/api/cron/reviews'));
  for (const label of ['Save update', 'Add to tasks', 'Put it on my calendar', 'Make a team version', 'Make an investor version', 'Save to Gmail drafts', 'Just me', 'Team and investors']) assert.ok(ui.includes(label), label);
  const visible = ui.match(/'[^'\n]{12,}'/g).join(' ');
  assert.doesNotMatch(visible, /—|–| -- /);
});
