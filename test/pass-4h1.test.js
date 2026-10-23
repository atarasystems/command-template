import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('4H.1 keeps normal actions readable and uses compact controls at narrow desktop widths', () => {
  assert.match(html, /body \{ font-size: 17px; \}/);
  assert.match(html, /\.btn, \.btn-save \{ font-size: 16px; border-radius: var\(--radius-md\); \}/);
  assert.match(html, /@media \(max-width: 1180px\)/);
  assert.match(html, /header \.header-nav-link \{ display: none; \}/);
});

test('the founder template has no links into Atara admin tools', () => {
  assert.doesNotMatch(html, /atarasystems\.com|atara-audits|SCOPE admin/);
});

test('4H.1 replaces program opportunity UUID entry with human-readable lookups', () => {
  assert.match(html, /id="program-contact-lookup"[^>]*list="program-contact-options"/);
  assert.match(html, /id="program-account-lookup"[^>]*list="program-account-options"/);
  assert.match(html, /id="program-contact-id" type="hidden"/);
  assert.match(html, /id="program-account-id" type="hidden"/);
  assert.match(html, /loadProgramOpportunityLookups/);
  assert.match(html, /resolveProgramOpportunityLinks\(\)/);
});

test('4H.1 preserves explicit Gmail setup and thread labeling controls', () => {
  assert.match(html, /id="relationship-gmail-setup-button"/);
  assert.match(html, /refreshRelationshipGmailLabelSetup/);
  assert.match(html, /Label thread/);
  assert.match(html, /thread_id:threadId/);
});

test('4H.1 keeps Tickler backed by Work items and never calls the old sheets bridge', () => {
  assert.match(html, /workRequest\('\/api\/work\/items'/);
  assert.match(html, /defer_until/);
  assert.match(html, /source_type:'manual_tickler'/);
  assert.doesNotMatch(html.slice(html.lastIndexOf('submitTicklerItem = async function')), /due_at:date/);
  assert.doesNotMatch(html, /\/api\/proxy|script\.google\.com/);
});

test('4H.1 keeps Email Intelligence collapsed by default and explicitly toggleable', () => {
  assert.match(html, /id="email-intelligence-list" hidden style="display:none;"/);
  assert.match(html, /id="email-intelligence-toggle"[^>]*aria-expanded="false"/);
  assert.match(html, /setEmailIntelligenceExpanded/);
  assert.match(html, /button\.textContent=emailIntelligenceExpanded\?'Hide emails':'Show emails'/);
  assert.match(html, /Scan inbox/);
  assert.match(html, /Review/);
});

test('4H.1 keeps closed mobile panels and calendar content within usable bounds', () => {
  assert.match(html, /\.slide-panel \{ width: 100%; right: calc\(-100% - 40px\); \}/);
  assert.match(html, /#river-panel \{ width: 100%; right: calc\(-100% - 40px\); \}/);
  assert.match(html, /\.cal-event-title \{[^}]*white-space: normal;[^}]*-webkit-line-clamp: 2/);
  assert.match(html, /heightPx\s*=\s*Math\.max\([^;]+, 38\)/);
});
