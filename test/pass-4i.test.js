import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { HUB_TYPE_LABELS, normalizeOpportunityHub } from '../api/_lib/opportunity-hub.js';
import hubHandler from '../api/crm/opportunity-hub.js';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const hubApi = fs.readFileSync(new URL('../api/crm/opportunity-hub.js', import.meta.url), 'utf8');
const opportunityApi = fs.readFileSync(new URL('../api/crm/opportunities.js', import.meta.url), 'utf8');
const rpcMigration = fs.readFileSync(new URL('../supabase/schema/command-schema.sql', import.meta.url), 'utf8');

function response() { return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; } }; }

test('Opportunity Hub normalizes both existing opportunity tables into one founder view', () => {
  const rows = normalizeOpportunityHub({
    commercial: [{ id: 'commercial-1', offer_type: 'seo_geo_audit', pipeline: 'direct_audit', stage: 'new', lead_source: 'revenue_scout', account: { name: 'Acme' }, contact: { full_name: 'A Person', email: 'a@example.com' } }],
    programs: [{ id: 'program-1', title: 'Grant', status: 'awaiting_response', organization: 'Foundation', deadline_at: '2026-09-01T00:00:00Z', crm_accounts: null, crm_contacts: null }],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.type_label).sort(), ['Grant / Program', 'SEO/GEO Prospect']);
  const commercial = rows.find((row) => row.source_table === 'crm_opportunities');
  const program = rows.find((row) => row.source_table === 'crm_program_opportunities');
  assert.equal(commercial.organization, 'Acme');
  assert.equal(commercial.person, 'A Person');
  assert.equal(program.stage_label, 'Waiting');
});

test('Hub categories stay display-safe and do not invent constrained storage values', () => {
  assert.deepEqual(Object.values(HUB_TYPE_LABELS), ['SEO/GEO Prospect', 'Free Training', 'Paid Training', 'Consulting', 'Partner / Referral', 'Subcontracting', 'Grant / Program', 'Sponsorship / Licensing', 'Other Strategic']);
  const row = normalizeOpportunityHub({ commercial: [{ id: 'x', offer_type: 'other', pipeline: 'institutional', stage: 'researching', lead_source: 'manual' }] })[0];
  assert.equal(row.type_label, 'Other Strategic');
  assert.equal(row.underlying_status, 'researching');
});

test('Needs Attention uses stored dates, review states, human flags, and linked Work', () => {
  const rows = normalizeOpportunityHub({
    now: new Date('2026-08-28T12:00:00Z'),
    commercial: [{ id: 'x', offer_type: 'other', pipeline: 'direct_audit', stage: 'contacted', lead_source: 'manual', next_action: 'Call', next_action_at: '2026-08-29T12:00:00Z' }],
    workItems: [{ id: 'w', source_type: 'crm_opportunity', source_id: 'x', title: 'Call', status: 'open', due_at: '2026-08-29T12:00:00Z', owner_name: 'Maya' }],
  });
  assert.equal(rows[0].needs_attention, true);
  assert.equal(rows[0].work.owner, 'Maya');
});

test('Business Opportunities is one founder-facing surface without raw IDs or JSON workflow', () => {
  assert.match(html, /Business Opportunities/);
  assert.match(html, /Needs attention/);
  assert.match(html, /All opportunities/);
  assert.match(html, /Add Opportunity/);
  assert.match(html, /api\/crm\/opportunity-hub/);
  const hubStart = html.indexOf('id="panel-opportunity-hub"');
  const hubSection = html.slice(hubStart, html.indexOf('id="opportunity-hub-list"', hubStart) + 40);
  assert.doesNotMatch(hubSection, /Contact ID/);
  assert.doesNotMatch(hubSection, /Company \/ Account ID/);
});

test('Existing CRM and Program Opportunity paths remain referenced', () => {
  assert.match(hubApi, /crm_opportunities/);
  assert.match(hubApi, /crm_program_opportunities/);
  assert.match(html, /opportunities\/programs/);
  assert.match(html, /existing compatible workflow/);
  assert.match(html, /No record was created/);
});

test('Opportunity Hub route is session-protected and read-only', async () => {
  const res = response();
  await hubHandler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.match(hubApi, /withCommandAuth/);
  assert.doesNotMatch(hubApi, /method === 'POST'/);
});

test('Hub commercial creation explicitly disables follow-ups without changing legacy callers', () => {
  assert.match(html, /hubCommercialCreate/);
  assert.match(html, /auto_followups_enabled:false/);
  assert.match(opportunityApi, /Object\.hasOwn\(input, 'auto_followups_enabled'\)/);
  assert.match(opportunityApi, /booleanValue\(input\.auto_followups_enabled, 'auto_followups_enabled'\)/);
  assert.match(rpcMigration, /if input \? 'auto_followups_enabled' then/);
  assert.match(rpcMigration, /jsonb_typeof\(input->'auto_followups_enabled'\) <> 'boolean'/);
  assert.match(rpcMigration, /when explicit_auto_followups is not null then explicit_auto_followups/);
  assert.match(rpcMigration, /when suppressed then false/);
});
