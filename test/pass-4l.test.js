import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const todayBlock = html.slice(html.indexOf('id="founder-today-panel"'), html.indexOf('<!-- TWO COLUMN: ACTIONS + GRANTS -->'));
const ticklerBlock = html.slice(html.lastIndexOf('submitTicklerItem = async function'));

test('Founder Today has exactly five bounded attention sections', () => {
  for (const label of ['Do Today', 'Follow Up', 'Calendar', 'Waiting / Watch', 'Needs Review']) assert.match(todayBlock, new RegExp(label.replace(/[ /]/g, '\\$&')));
  for (const id of ['founder-today-do-list','founder-today-follow-list','founder-today-calendar-list','founder-today-wait-list','founder-today-review-list']) assert.match(todayBlock, new RegExp(id));
  assert.match(html, /items\.slice\(0,5\)/);
  assert.match(html, /View all \('/);
});

test('Founder Today uses existing data and excludes Scouts, Intelligence, and inbox scans', () => {
  assert.match(html, /workItems/);
  assert.match(html, /cmdAllContacts/);
  assert.match(html, /programOpportunities/);
  assert.match(html, /calEvents/);
  assert.match(html, /emailInsights/);
  assert.doesNotMatch(todayBlock, /scoutCandidateRows|scout-candidates|refreshIntelligence|scanEmailIntelligence/);
  assert.doesNotMatch(html.slice(html.indexOf('function founderTodayRender'), html.indexOf('function founderTodayRender') + 12000), /fetch\('\/api\/gmail\/intelligence'|scanEmailIntelligence\(/);
});

test('Founder Today applies ownership, bounded active work, empty states, and dedupe', () => {
  assert.match(html, /owner === 'founder'/);
  assert.match(html, /unassignedUrgent/);
  assert.match(html, /delegatedFounder/);
  assert.match(html, /founderTodayDeferred\(item\)/);
  assert.match(html, /new Set\(\)/);
  for (const text of ['Nothing due today.', 'No follow-ups due.', 'No calendar events today.', 'Nothing is waiting for attention.', 'No reviews waiting.']) assert.match(html, new RegExp(text.replace(/[.?]/g, '\\$&')));
});

test('manual Tickler uses native Work with defer_until, not the legacy due_at-only path', () => {
  assert.match(html, /fetch\(path, requestOptions\)/);
  assert.match(html, /Object\.assign\(\{ credentials:'include' \}/);
  assert.match(html, /requestOptions\.cache = 'no-store'/);
  assert.match(ticklerBlock, /workRequest\('\/api\/work\/items'/);
  assert.match(ticklerBlock, /status:'open'/);
  assert.match(ticklerBlock, /defer_until:wake/);
  assert.match(ticklerBlock, /source_type:'manual_tickler'/);
  assert.match(ticklerBlock, /created\?\.id/);
  assert.match(ticklerBlock, /await loadTickler\(\);await loadWorkSurface\(\)/);
  assert.match(ticklerBlock, /allTicklerItems\|\|\[\]\)\.some/);
  assert.match(ticklerBlock, /Tickler was saved but could not be read back/);
  assert.match(ticklerBlock, /showToast\('Added to Tickler'\)/);
  assert.doesNotMatch(ticklerBlock, /postData\('command'/);
  assert.doesNotMatch(ticklerBlock, /due_at:date/);
});

test('Tickler wake conversion uses the founder time zone and handles DST by timezone data', () => {
  const start = html.indexOf('function commandEasternStartIso');
  const source = html.slice(start, start + 1100);
  assert.match(source, /timeZone:\(globalThis\.CMD_TZ \|\| 'America\/New_York'\)/);
  assert.match(source, /formatToParts/);
  assert.match(source, /new Date\(guess - \(rendered - guess\)\)\.toISOString/);
  assert.match(html, /defer_until/);
});

test('Today retains glance metrics and does not alter Morning Brief or Calendar backend', () => {
  assert.match(html, /id="m-due-today"/);
  assert.match(html, /id="m-overdue"/);
  assert.match(html, /id="m-milestone-days"/);
  assert.match(html, /id="m-runway"/);
  assert.match(html, /function loadCalendarWeek\(\)/);
  assert.match(html, /loaders=\[loadWorkSurface/);
  assert.doesNotMatch(html.slice(html.indexOf('function refreshCommandData'), html.indexOf('function refreshCommandData') + 900), /refreshIntelligence|scanEmailIntelligence/);
});

test('Today mobile layout stacks without horizontal overflow and keeps readable type', () => {
  assert.match(html, /\.founder-today-grid\s*\{[^}]*grid-template-columns:repeat\(2/);
  assert.match(html, /@media \(max-width: 700px\)\s*\{ \.founder-today-grid \{ grid-template-columns:1fr;/);
  assert.match(html, /body \{ font-size: 17px; \}/);
  assert.match(html, /min-height:44px/);
});

test('Pass 4L.2 keeps one sticky navigation bar and adds founder-controlled Low Capacity mode', () => {
  assert.match(html, /<header class="command-header">/);
  assert.match(html, /header\.command-header \{ position:sticky; top:0; z-index:100; isolation:isolate;/);
  assert.match(html, /main > \*, \.panel \{ scroll-margin-top: 88px; \}/);
  assert.match(html, /id="low-capacity-toggle"[^>]*type="button"/);
  assert.doesNotMatch(html, /<button[^>]*id="low-capacity-toggle"[^>]*onclick=/);
  assert.match(html, /function bindCommandHeaderControls\(\)/);
  assert.match(html, /\['low-capacity-toggle', toggleLowCapacity\]/);
  assert.match(html, /aria-pressed="false"/);
  for (const section of ['Now', 'Next 24 Hours', 'Calendar']) assert.match(html, new RegExp(`<h3>${section}</h3>`));
  assert.match(html, /items\.slice\(0,3\)/);
  assert.match(html, /body\.low-capacity-mode main > :not\(#low-capacity-panel\)/);
  assert.match(html, /Show Full Command/);
  assert.match(html, /localStorage\.setItem\('atara-command\.low-capacity'/);
  assert.match(html, /localStorage\.getItem\('atara-command\.low-capacity'/);
  assert.match(html, /founderTodayUrgent\(item\)/);
  assert.doesNotMatch(html.slice(html.indexOf('function lowCapacityRender'), html.indexOf('function lowCapacityRender') + 12000), /fetch\(/);
});

test('Pass 4L.3 keeps Low Capacity calm and distinguishable without changing its behavior', () => {
  assert.match(html, /#low-capacity-toggle \{ background:#FFFFFF; color:#0F172A;/);
  assert.match(html, /#low-capacity-toggle\[aria-pressed="true"\] \{ background:#E2E8F0; color:#0F172A; border-color:#94A3B8;/);
  assert.doesNotMatch(html.slice(html.indexOf('function toggleLowCapacity'), html.indexOf('function toggleLowCapacity') + 900), /fetch\(|window\.location/);
  assert.match(html, /id="low-capacity-toggle"[^>]+aria-pressed="false"/);
});
