import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const growth = html.slice(html.indexOf('<div class="command-nav-group-title">Growth</div>'), html.indexOf('<div class="command-nav-group-title">Knowledge</div>'));

test('Funding Hub is the first Growth destination and uses the shared mobile nav button styling', () => {
  assert.match(growth, /^<div class="command-nav-group-title">Growth<\/div><a href="\/applications\.html">Funding Hub<\/a>/);
  assert.match(html, /\.command-nav-group button, \.command-nav-group a \{[\s\S]*box-sizing: border-box; text-decoration: none;/);
});

test('Business Opportunities keeps its existing panel route with clear commercial language', () => {
  assert.match(growth, /mobileNavGo\('panel-opportunity-hub'\)">Business Opportunities<\/button>/);
  assert.match(html, /Revenue, partnerships, consulting, and strategic business opportunities\./);
  assert.match(html, /id="panel-opportunity-hub"/);
});

test('Program Opportunities remains available as a distinct raw record-management surface', () => {
  assert.match(growth, /mobileNavGo\('panel-program-opportunities'\)">Program Opportunities<\/button>/);
  assert.match(html, /function openProgramOpportunitiesAdmin\(\) \{ openPanel\('program-opportunities-panel'\); loadProgramOpportunities\(\); \}/);
  assert.match(html, /id="program-opportunities-panel"/);
  assert.match(html, /function loadProgramOpportunities\(\)/);
  assert.match(html, /function addProgramOpportunity\(\)/);
  assert.match(html, /id="program-opportunity-panel"/);
});

test('Program Opportunities is not rendered as a main dashboard section', () => {
  assert.doesNotMatch(html, /<div class="panel" id="panel-program-opportunities"/);
  assert.doesNotMatch(html, /founder-area-card-title">Funding<\/div>/);
  assert.match(html, /id="program-opportunities-panel"[^>]*aria-labelledby="program-opportunities-title"/);
});

test('Growth navigation has no duplicate Funding Hub or Business Opportunities entries', () => {
  assert.equal((growth.match(/>Funding Hub</g) || []).length, 1);
  assert.equal((growth.match(/>Business Opportunities</g) || []).length, 1);
  assert.equal((growth.match(/>Program Opportunities</g) || []).length, 1);
});
