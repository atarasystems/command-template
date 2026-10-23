import test from 'node:test';
import assert from 'node:assert/strict';
import { planWeek, mondayOf, writePost, buildPrompt, defaultBrain } from '../api/_lib/linkedin-posts.js';
import { SAMPLE } from './fixtures/founder.js';

test('three posts on Mon, Wed, Fri with the Triple R mix', () => {
  const monday = mondayOf('2026-10-21');
  assert.equal(monday, '2026-10-19');
  const plan = planWeek(monday, { hasStory: false, hasNews: false, settings: SAMPLE });
  assert.deepEqual(plan.map((p) => p.post_date), ['2026-10-19', '2026-10-21', '2026-10-23']);
  assert.equal(plan[0].post_type, 'contrarian');
  assert.equal(plan[1].post_type, 'framework', 'no real story means a framework, never an invented one');
  assert.equal(plan[2].post_type, 'relationship');
  assert.equal(new Set(plan.map((p) => p.topic)).size, 3, 'each post covers a different topic');
  assert.equal(planWeek(monday, { hasStory: true, settings: SAMPLE }).at(1).post_type, 'behind_scenes');
  const tueThu = planWeek(monday, { settings: { ...SAMPLE, schedule: { ...SAMPLE.schedule, linkedin_post_days: [2, 4, 6] } } });
  assert.deepEqual(tueThu.map((p) => p.post_date), ['2026-10-20', '2026-10-22', '2026-10-24'], 'post days come from setup');
});

test('drafts follow the no-dash setting and get one sharper retry when they miss the $1,000 filter', async () => {
  let calls = 0;
  const ai = async () => { calls += 1; return JSON.stringify(calls === 1 ? { body: 'Weak — post', filter_pass: false, filter_note: 'too general' } : { body: 'Sharp post — here', filter_pass: true, filter_note: 'specific' }); };
  const out = await writePost({ post: { post_type: 'framework', topic: 'nw' }, brain: 'b', settings: SAMPLE }, { ai });
  assert.equal(calls, 2);
  assert.equal(out.body, 'Sharp post, here');
});

test('behind-the-scenes prompt only allows real events', () => {
  const p = buildPrompt({ post: { post_type: 'behind_scenes', topic: 'founder' }, brain: 'b', stories: ['Shipped the order page today'], settings: SAMPLE });
  assert.match(p.user, /Shipped the order page today/);
  assert.match(p.user, /Maya's personal profile/);
  assert.match(p.user, /founder story building Northwind/);
  assert.doesNotMatch(p.system + p.user, /Solei|Atara|SpectrumThrive|SCOPE/);
  assert.match(p.system, /Never invent stories/);
});

test('the starting brain comes from setup, with blanks to fill when a section is empty', () => {
  const brain = defaultBrain({ ...SAMPLE, audience: { who: 'Bakery owners', beliefs: 'Small shops deserve good tools' } });
  assert.match(brain, /Bakery owners/); assert.match(brain, /Small shops deserve good tools/); assert.match(brain, /coffee chat/);
  assert.match(defaultBrain(), /\[who you serve\]/);
});
