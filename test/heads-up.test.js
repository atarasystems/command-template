import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanHeadsUp, worthReading, eventForAi, headsUpPrompt, readEvent, headsUpFromEmail } from '../api/_routes/_lib/heads-up.js';

const gbeta = {
  id: 'ev1', summary: 'BVVL gBETA Delaware Interviews - Fall 2026 (Maya Rivers)', updated: 'x', status: 'confirmed',
  start: { dateTime: '2026-09-29T15:45:00-04:00' }, organizer: { email: 'claudius@gener8tor.com' }, attendees: [{ email: 'solei@atarasystems.com', self: true }, { email: 'claudius@gener8tor.com' }],
  description: 'The 15-minute interview will be hosted via Zoom.<br>Zoom Link: https://gener8tor.zoom.us/my/claudiustaylor<br>In the Zoom interview, we\'d like you to spend 5 minutes presenting a pitch deck. Leave the remaining time for Q&amp;A.<br>We would like your presentation to cover:<br>-Team background<br>-Genesis of the business<br>-Traction to date',
};

test('the prompt asks for the real format of a meeting, prep, and topics to cover', () => {
  const p = headsUpPrompt('2026-09-28');
  assert.match(p, /differs from its title/);
  assert.match(p, /pitch deck/);
  assert.match(p, /topics she is asked to cover/);
  assert.doesNotMatch(p, /[–—]/);
});

test('an invite with details is read; her own routine blocks are skipped', () => {
  assert.equal(worthReading(gbeta), true);
  assert.equal(worthReading({ summary: 'Social engagement', description: 'Reply to comments, interact naturally, then stop. Every day.', organizer: { self: true }, recurringEventId: 'r', attendees: [{ self: true }] }), false);
  assert.equal(worthReading({ summary: 'Lunch', description: '' }), false);
});

test('the full invite reaches the AI, including the part below the Zoom link', () => {
  const text = eventForAi(gbeta, '');
  assert.match(text, /spend 5 minutes presenting a pitch deck/);
  assert.match(text, /Traction to date/);
  assert.doesNotMatch(text, /<br>/);
});

test('the gBETA invite comes back as a pitch with a prep list', async () => {
  process.env.GEMINI_API_KEY = 'g';
  const fake = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ heads_up: 'This is a 5 minute pitch with a deck, then Q&A. Prepare slides before you join.', prep: ['Make a short deck covering: team background, genesis of the business, traction to date', 'Practice the pitch in 5 minutes', 'Test Zoom screen share'] }) }] } }] }) });
  const r = await readEvent(gbeta, '', { today: '2026-09-28', fetchImpl: fake });
  assert.match(r.heads_up, /5 minute pitch/);
  assert.equal(r.prep.length, 3);
  assert.equal(r.prep[0].done, false);
  assert.equal(r.has_news, true);
});

test('nothing to flag stays quiet', () => {
  assert.deepEqual(cleanHeadsUp({ heads_up: '', prep: [] }), { heads_up: null, prep: [], has_news: false });
  assert.equal(cleanHeadsUp({ heads_up: 'Arrive early — parking is tight' }).heads_up, 'Arrive early, parking is tight');
});

test('an email with an event and things to prepare becomes a heads up', async () => {
  const saved = [];
  const db = { from() { return { upsert(row) { saved.push(row); return Promise.resolve({ error: null }); } }; } };
  const meta = { message_id: 'm9', subject: 'Interview booked', received_at: '2026-09-28T19:44:00Z' };
  await headsUpFromEmail(db, meta, { heads_up: 'It is a pitch, not a chat.', items: [{ type: 'event', title: 'gBETA interview', date: '2026-09-29', time: '15:45' }, { type: 'prepare', title: 'Pitch deck', details: 'team, genesis, traction', date: '2026-09-29' }] }, { today: '2026-09-28' });
  assert.equal(saved[0].source_id, 'mail:m9');
  assert.equal(saved[0].heads_up, 'It is a pitch, not a chat.');
  assert.match(saved[0].prep[0].text, /Pitch deck: team, genesis, traction/);
  // A past event makes no heads up.
  saved.length = 0;
  await headsUpFromEmail(db, meta, { heads_up: 'x', items: [{ type: 'event', title: 'old', date: '2026-09-01' }] }, { today: '2026-09-28' });
  assert.equal(saved.length, 0);
});
