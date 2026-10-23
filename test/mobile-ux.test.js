import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('mobile navigation keeps primary actions visible and operating areas reachable', () => {
  assert.match(html, /class="mobile-nav-toggle"/);
  assert.match(html, /id="mobile-nav-menu"/);
  for (const panel of ['top', 'panel-actions', 'panel-ai-team', 'panel-knowledge', 'panel-program-opportunities', 'panel-revenue-crm']) {
    assert.match(html, new RegExp(`mobileNavGo\\('${panel}'\\)`));
  }
  assert.match(html, /header \.header-nav-link \{ display: none; \}/);
});

test('Universal Work has a non-overflowing mobile card treatment', () => {
  assert.match(html, /class="work-table-wrap"/);
  assert.match(html, /class="universal-work-table"/);
  for (const label of ['Item', 'Category', 'Owner', 'Status', 'Due']) assert.match(html, new RegExp(`data-label="${label}"`));
  assert.match(html, /\.universal-work-table thead \{ display: none; \}/);
  assert.match(html, /\.universal-work-table td::before \{ content: attr\(data-label\)/);
  assert.match(html, /renderWorkActionTable[\s\S]*class="universal-work-table"/);
  assert.match(html, /#action-filters \.filter-select \{ width: 100%;/);
});
