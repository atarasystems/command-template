import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Funding Hub exposes a secondary dismiss action and human dismissal flow', () => {
  const html = read('applications.html');
  assert.match(html, /openDismiss/);
  assert.match(html, /Dismiss this opportunity\?/);
  assert.match(html, /Choose a dismissal reason first/);
  assert.match(html, /Dismiss Opportunity/);
  assert.match(html, /Restore to Options/);
});

test('dismissal API is authenticated, additive, reasoned, and protects submitted history', () => {
  const source = read('api/_routes/opportunities/programs.js');
  assert.match(source, /withCommandAuth/);
  assert.match(source, /DISMISS_REASONS/);
  assert.match(source, /status: 'archived'/);
  assert.match(source, /dismissed_reason/);
  assert.match(source, /DISMISS_SUBMITTED_LOCKED/);
  assert.match(source, /action === 'restore'/);
  assert.doesNotMatch(source, /crm_program_opportunities.*delete.*dismiss/);
});

test('the starting schema has the dismissal fields and never drops data', () => {
  const sql = read('supabase/schema/command-schema.sql');
  assert.match(sql, /dismissed_reason text/);
  assert.match(sql, /dismissed_note text/);
  assert.match(sql, /dismissed_at timestamp with time zone/);
  assert.doesNotMatch(sql, /\bDROP\s+TABLE|\bTRUNCATE\b|\bDELETE\s+FROM/i);
});
