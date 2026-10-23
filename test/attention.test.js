import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { aiWorkNeedsFounder, summarizeAiTeam } from '../api/_lib/ai-team.js';

const source = fs.readFileSync(new URL('../attention.js', import.meta.url), 'utf8');
const context = { Intl, Date, Map, Set, Number, String, Array, isNaN, globalThis: {} };
vm.runInNewContext(fs.readFileSync(new URL('../email-attention.js', import.meta.url), 'utf8'), context);
vm.runInNewContext(source, context);
const attention = context.globalThis.AtaraAttention;

const now = '2026-09-02T16:00:00.000Z';

test('attention projection keeps ordinary Maya ownership out of Needs Me', () => {
  const model = attention.build({ now, work: [
    { id:'ordinary', title:'Someday work', owner_type:'founder', status:'open', priority:'now' },
    { id:'high-ordinary', title:'High priority implementation', owner_type:'founder', status:'open', priority:'high' },
    { id:'project', title:'Finish active project implementation', owner_type:'founder', status:'open', project_id:'project-1', notes:'Continue the active project.' },
  ] });
  assert.equal(model.NEEDS_ME_NOW.length, 0);
  assert.equal(model.AVAILABLE_IN_DETAIL.length, 0);
});

test('attention precedence distinguishes founder decision, waiting, and stale work', () => {
  const model = attention.build({ now, work: [
    { id:'approval', title:'Approve proposal', owner_type:'founder', status:'open', notes:'Needs founder approval' },
    { id:'waiting', title:'Await partner response', owner_type:'founder', status:'waiting', notes:'Waiting on partner' },
    { id:'stale', title:'Ancient priority item', owner_type:'founder', status:'open', priority:'now', due_at:'2026-08-01T16:00:00.000Z' },
    { id:'soon', title:'Real application due item', owner_type:'founder', status:'open', category:'application', due_at:'2026-09-03T16:00:00.000Z' },
  ] });
  assert.equal(Array.from(model.NEEDS_ME_NOW, (row) => row.id).join(','), 'approval,soon');
  assert.equal(Array.from(model.WAITING_WATCH, (row) => row.id).join(','), 'waiting');
  assert.match(model.NEEDS_ME_NOW[0].reason, /Needs founder approval/);
  assert.match(model.NEEDS_ME_NOW[1].reason, /consequential obligation due soon/i);
});

test('explicit founder blocker qualifies while generic review language does not', () => {
  context.globalThis.CMD_FIRST_NAME = 'Maya';
  const model = attention.build({ now, work: [
    { id:'generic', title:'Review project notes', owner_type:'founder', status:'open', notes:'Review when convenient.' },
    { id:'blocked', title:'Approve research direction', owner_type:'ai', status:'open', notes:'Blocked until Maya approval of the research direction.' },
  ] });
  assert.equal(model.NEEDS_ME_NOW.map((row) => row.id).join(','), 'blocked');
  assert.match(model.NEEDS_ME_NOW[0].reason, /Blocked until Maya approval/);
});

test('attention deduplicates email records by Gmail thread', () => {
  const model = attention.build({ now, emails: [
    { id:'one', gmail_thread_id:'thread-1', review_status:'pending', subject:'City Fund deadline', snippet:'Please respond by the deadline', sender_name:'City Fund grant officer' },
    { id:'two', gmail_thread_id:'thread-1', review_status:'pending', subject:'City Fund deadline', snippet:'Please respond by the deadline', sender_name:'City Fund grant officer' },
  ] });
  assert.equal(model.NEEDS_ME_NOW.length, 1);
});

test('Gmail-derived Work and its insight share one founder-attention item', () => {
  const model = attention.build({ now, work: [{ id:'work-1', title:'Review grant update', owner_type:'founder', status:'open', source_type:'gmail', source_id:'message-1', notes:'Needs founder approval' }], emails: [{ id:'insight-1', gmail_message_id:'message-1', gmail_thread_id:'thread-1', review_status:'pending', subject:'City Fund update', snippet:'Please review', sender_name:'City Fund' }] });
  assert.equal(model.NEEDS_ME_NOW.length, 1);
});

test('past calendar events disappear while consequential future events remain waiting/watch', () => {
  const model = attention.build({ now, calendar: [
    { id:'past', title:'Finished meeting', start:'2026-09-02T14:00:00.000Z', end:'2026-09-02T15:00:00.000Z' },
    { id:'future', title:'Upcoming meeting', start:'2026-09-02T17:00:00.000Z', end:'2026-09-02T18:00:00.000Z', requires_preparation:true },
  ] });
  assert.equal(model.WAITING_WATCH.some((row) => row.id === 'past'), false);
  assert.equal(model.WAITING_WATCH.some((row) => row.id === 'future'), true);
});

test('program deadline aging preserves a recent unresolved deadline as important change', () => {
  const model = attention.build({ now, programs: [{ id:'program', title:'Unresolved program', status:'reviewing', deadline_at:'2026-09-01T16:00:00.000Z', organization:'Funder' }] });
  assert.equal(model.IMPORTANT_CHANGE[0].id, 'program');
  assert.match(model.IMPORTANT_CHANGE[0].reason, /Deadline passed/);
});

test('email projection suppresses generic information but retains consequential information', () => {
  const model = attention.build({ now, emails: [
    { id:'important', gmail_thread_id:'a', review_status:'pending', subject:'Bakery grant application deadline', snippet:'Please respond by Friday', sender_name:'Dana Lee, Program Officer' },
    { id:'generic', gmail_thread_id:'b', review_status:'pending', subject:'Introducing the new Mac mini', snippet:'Product announcement', sender_name:'Apple' },
    { id:'sales-pitch', gmail_thread_id:'c', review_status:'pending', subject:'Turn your business into an Automated Sales Booking Machine', snippet:'Book a demo today', sender_name:'Marketing list' },
  ] });
  assert.equal(model.NEEDS_ME_NOW[0].id, 'important');
  assert.equal(model.AVAILABLE_IN_DETAIL.length, 0);
  assert.equal(model.IMPORTANT_CHANGE.some((row) => ['generic', 'sales-pitch'].includes(row.id)), false);
});

test('relative email dates resolve against received_at and stale dates do not surface', () => {
  const aug25 = attention.emailDateContext({ subject:'3 events happening tomorrow', received_at:'2026-08-25T16:00:00.000Z' }, now);
  const aug27 = attention.emailDateContext({ subject:'1 event happening tomorrow', received_at:'2026-08-27T16:00:00.000Z' }, now);
  assert.equal(attention.easternDate(aug25.date), '2026-08-26');
  assert.equal(attention.easternDate(aug27.date), '2026-08-28');
  assert.equal(aug25.past, true);
  assert.equal(aug27.past, true);
  const model = attention.build({ now, emails: [
    { id:'old-25', review_status:'pending', subject:'3 events happening tomorrow', received_at:'2026-08-25T16:00:00.000Z' },
    { id:'old-27', review_status:'pending', subject:'1 event happening tomorrow', received_at:'2026-08-27T16:00:00.000Z' },
  ] });
  assert.equal(model.NEEDS_ME_NOW.length, 0);
  assert.equal(model.IMPORTANT_CHANGE.length, 0);
  assert.equal(model.AVAILABLE_IN_DETAIL.length, 0);
});

test('structured dates override stale email language and unsupported deadline text stays non-urgent', () => {
  const model = attention.build({ now, emails: [
    { id:'structured', review_status:'pending', subject:'Northwind event happening tomorrow', snippet:'Ordinary event information.', received_at:'2026-08-25T16:00:00.000Z', event_at:'2026-09-10T16:00:00.000Z' },
    { id:'old-deadline', review_status:'pending', subject:'Application deadline reminder', received_at:'2026-08-25T16:00:00.000Z' },
    { id:'absolute', review_status:'pending', subject:'NSF deadline September 8, 2026', snippet:'Please review and respond.', received_at:'2026-09-02T16:00:00.000Z', sender_name:'NSF Program Officer' },
  ] });
  assert.equal(model.NEEDS_ME_NOW.some((row) => row.id === 'structured'), false);
  assert.equal(model.NEEDS_ME_NOW.some((row) => row.id === 'absolute'), true);
  assert.equal(model.NEEDS_ME_NOW.some((row) => row.id === 'old-deadline'), false);
});

test('relative email resolution handles Eastern midnight and weekday names', () => {
  const beforeMidnight = attention.emailDateContext({ subject:'tomorrow', received_at:'2026-08-25T03:30:00.000Z' }, now);
  const afterMidnight = attention.emailDateContext({ subject:'tomorrow', received_at:'2026-08-25T04:30:00.000Z' }, now);
  const weekday = attention.emailDateContext({ subject:'Friday event', received_at:'2026-08-27T16:00:00.000Z' }, now);
  assert.equal(attention.easternDate(beforeMidnight.date), '2026-08-25');
  assert.equal(attention.easternDate(afterMidnight.date), '2026-08-26');
  assert.equal(attention.easternDate(weekday.date), '2026-08-28');
});

test('ordinary calendar events stay in Calendar while consequential changes can surface', () => {
  const model = attention.build({ now, calendar: [
    { id:'ordinary', title:'Team sync', start:'2026-09-02T17:00:00.000Z', end:'2026-09-02T18:00:00.000Z' },
    { id:'prep', title:'Funder meeting', start:'2026-09-02T19:00:00.000Z', end:'2026-09-02T20:00:00.000Z', requires_preparation:true },
  ] });
  assert.equal(model.WAITING_WATCH.some((row) => row.id === 'ordinary'), false);
  assert.equal(model.WAITING_WATCH[0].id, 'prep');
  assert.match(model.WAITING_WATCH[0].reason, /Preparation/);
});

test('Eastern date helpers keep date-only values stable across DST', () => {
  assert.equal(attention.easternDate('2026-03-08T05:00:00.000Z'), '2026-03-08');
  assert.equal(attention.easternDate('2026-11-01T05:00:00.000Z'), '2026-11-01');
  assert.equal(attention.dateInputValue('2026-09-02T03:00:00.000Z'), '2026-09-01');
  const bounds = attention.easternWeekBounds(0);
  assert.equal(bounds.sunday instanceof Date, true);
  assert.equal(bounds.saturday > bounds.sunday, true);
});

test('AI Team only exposes explicit AI-owned Maya blockers, not Maya-owned work', () => {
  assert.equal(aiWorkNeedsFounder({ owner_type:'founder', status:'open', title:'Founder work' }), false);
  assert.equal(aiWorkNeedsFounder({ owner_type:'ai', status:'in_progress', title:'AI work' }), false);
  assert.equal(aiWorkNeedsFounder({ owner_type:'ai', status:'waiting', notes:'Waiting for Maya approval' }), true);
  const summary = summarizeAiTeam([{ owner_type:'founder', status:'open' }, { owner_type:'ai', status:'waiting', notes:'Waiting for founder decision' }]);
  assert.equal(summary.needs_founder_count, 1);
});

test('founder home is capped and retains drill-in surfaces', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="founder-home-panel"/);
  assert.match(html, /founderHomeRenderList\('founder-home-needs'/);
  assert.match(html, /slice\(0, 5\)/);
  for (const id of ['panel-actions','panel-ai-team','panel-calendar','panel-email-intelligence','panel-opportunity-hub','panel-revenue-crm']) assert.match(html, new RegExp("scrollToPanel\\('" + id + "'\\)"));
  assert.match(html, /progressive-home-mode main > :not\(#low-capacity-panel\):not\(#founder-home-panel\)/);
  assert.match(html, /founderAttentionLowCapacityRender/);
  assert.match(html, /AtaraAttention\.build/);
  assert.match(html, /Weekly Email Review/);
  assert.match(html, /openWeeklyReview/);
});

test('founder drill-ins keep Home compact and reserve full expansion for Show Full Command', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /body\.progressive-home-detail main > :not\(#low-capacity-panel\):not\(#founder-home-panel\):not\(\.founder-active-detail\)/);
  assert.match(html, /function openFounderDetail\(id\)/);
  assert.match(html, /function closeFounderDetail\(\)/);
  assert.match(html, /onclick="closeFounderDetail\(\)"/);
  assert.match(html, /async function openWeeklyReview\(\) \{ openFounderDetail\('panel-weekly-review'\)/);
  assert.match(html, /panel-weekly-review[\s\S]*?weekly-review-list/);
  assert.doesNotMatch(html.match(/async function openWeeklyReview\(\)[\s\S]*?\nasync function viewWeeklyReviewMessage/)[0], /showFullCommand/);
  const weeklyRender = html.match(/function renderWeeklyReview\(\)[\s\S]*?\nasync function loadWeeklyReview/);
  assert.ok(weeklyRender);
  assert.match(weeklyRender[0], /File approved emails \(32\)/);
  assert.doesNotMatch(weeklyRender[0], /gmail_message_id/);
  assert.match(html, /scrollToPanel = function \(id\) \{ if \(document\.body\.classList\.contains\('progressive-home-mode'\) \|\| document\.body\.classList\.contains\('progressive-home-detail'\)\) \{ openFounderDetail\(id\); return; \}/);
  assert.match(html, /function showFullCommand\(\) \{[\s\S]*?classList\.remove\('progressive-home-mode','progressive-home-detail'\)/);
  assert.match(html, /founderDetailState='full-command'/);
});

test('approved Weekly Review filing action is exact, authenticated, and founder-readable', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const match = html.match(/var APPROVED_WEEKLY_REVIEW_MESSAGE_IDS = Object\.freeze\((\[[\s\S]*?\])\);/);
  assert.ok(match, 'approved batch should be embedded as a fixed internal set');
  const approved = vm.runInNewContext('(' + match[1] + ')');
  assert.equal(approved.length, 32);
  assert.equal(new Set(approved).size, 32);
  for (const excluded of [
    '1a034eb9f954c71b', '1a035162548e79d4', '1a03a7fba9c4eebc',
    '1a03f9c64ff5d129', '1a03fdba9624ccfe', '1a0423b544988aeb',
    '1a04314e03bba361', '1a043431c3c753b3', '1a04356ee6b50146',
    '1a0439593cf3dd69', '1a043b4799427b8d', '1a043c76e7641bef',
    '1a043d01784f2662',
  ]) assert.equal(approved.includes(excluded), false);
  assert.match(html, /File approved emails \(32\)/);
  assert.match(html, /remaining\.length\?/);
  assert.match(html, /action:'file',gmail_message_id:ids\[i\]/);
  assert.match(html, /await loadWeeklyReview\(\);founderTodayRender\(\);showToast\('Filed '/);
  assert.match(html, /Weekly Review stopped after/);
  const action = html.match(/async function fileApprovedWeeklyReviewBatch[\s\S]*?\nfunction renderWeeklyReview/);
  assert.ok(action);
  assert.doesNotMatch(action[0], /delete|spam|reply|unsubscribe|block/i);
});

test('Weekly Review home and detail counts use the current labeled contents', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const helper = html.match(/function weeklyReviewCountLabel\(messages\) \{[\s\S]*?\}/);
  assert.ok(helper);
  const countLabel = vm.runInNewContext('(function' + helper[0].replace(/^function weeklyReviewCountLabel/, '') + ')');
  assert.equal(countLabel(new Array(32)), '32 in review');
  assert.equal(countLabel(new Array(31)), '31 in review');
  assert.equal(countLabel([]), '0 in review');
  assert.match(html, /id="founder-weekly-review-count"/);
  assert.match(html, /id="weekly-review-detail-count"/);
  assert.match(html, /count\.textContent=label/);
  assert.match(html, /detailCount\.textContent=label/);
  assert.doesNotMatch(html, /filed this week/);
});
