import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('Pass 4J provides one complete grouped navigation map', () => {
  assert.match(html, /class="mobile-nav-toggle"/);
  assert.match(html, /class="mobile-nav-menu command-nav-menu"/);
  for (const group of ['Today', 'Work', 'Relationships', 'Growth', 'Knowledge', 'Team + Operations']) {
    assert.ok(html.includes(`command-nav-group-title">${group}`));
  }
  for (const destination of [
    "top", 'panel-actions', 'panel-projects', 'panel-calendar', 'panel-tickler',
    'panel-relationship-desk', 'panel-revenue-crm', 'panel-email-desk',
    'panel-email-intelligence', 'panel-contacts-full', 'panel-opportunity-hub',
    'panel-program-opportunities',
    'panel-knowledge', 'panel-ai-team'
  ]) assert.match(html, new RegExp(`mobileNavGo\\('${destination}'\\)`));
  assert.match(html, /mobileNavGo\('prompt-library'\)/);
  assert.match(html, /max-height: min\(78vh, 720px\); overflow-y: auto/);
  assert.match(html, /else if \(id === 'prompt-library'\) showPromptLibrary\(\)/);
  assert.match(html, /menu\.classList\.remove\('open'\)/);
});

test('Prompt Library keeps its direct action and SCOPE Scout Review is gone', () => {
  assert.match(html, /function showPromptLibrary\(\)/);
  assert.match(html, /onclick="showPromptLibrary\(\)">Open Prompt Library/);
  assert.doesNotMatch(html, /openScoutCandidates|Scout Review|panel-audit-desk/);
});

test('Pass 4J makes Knowledge modules compact without reducing accessible base typography', () => {
  assert.match(html, /#panel-knowledge \.pdf-card \{ min-height: 0; padding: 14px;/);
  assert.match(html, /#panel-knowledge \.knowledge-list \{ min-height: 0; \}/);
  assert.match(html, /#panel-knowledge \.pdf-card-title \.btn \{ min-height: 40px;/);
  assert.match(html, /body \{ font-size: 17px; \}/);
  assert.match(html, /#panel-knowledge \.pdf-card-title \.btn-teal \{ background: var\(--color-white\)/);
});

test('Pass 4J does not add Industry Radar or change Scout backend files', () => {
  assert.doesNotMatch(html, /Industry Radar/);
  assert.doesNotMatch(html, /fetch\(['"]\/api\/crm\/scout-candidates['"][\s\S]{0,1000}crm_create_opportunity/);
});
