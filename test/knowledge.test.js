import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import knowledgeHandler from '../api/_routes/knowledge/index.js';
import { hasInitializedSupabaseClient } from '../api/_routes/_lib/supabase.js';

function response() {
  return { statusCode: 200, payload: null, status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; } };
}

test('knowledge API is session-protected before database initialization', async () => {
  assert.equal(hasInitializedSupabaseClient(), false);
  const res = response();
  await knowledgeHandler({ method: 'GET', query: { kind: 'all' }, headers: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.error.code, 'UNAUTHORIZED');
  assert.equal(hasInitializedSupabaseClient(), false);
});

test('Pass 4F knowledge API uses only columns in the applied schema', async () => {
  const source = await readFile(new URL('../api/_routes/knowledge/index.js', import.meta.url), 'utf8');
  for (const expected of ['canonical_live_link', 'is_canonical', 'last_reviewed_at', 'needs_update_reason', 'living_doc_id', 'export_type', 'show_today', 'recurring_use_label', 'last_copied_at']) assert.match(source, new RegExp(expected));
  for (const forbidden of ['archived_at', 'canonical_link', 'canonical:', 'last_reviewed:', 'document_id', 'format:', 'description:', 'recurring_label', 'last_copied:']) assert.doesNotMatch(source, new RegExp(forbidden));
  for (const forbidden of ['partner_report_requests', 'public.leads', 'Stripe', 'credit_redemption', 'generate-website-audit', 'send-email', 'river-action']) assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false);
});

test('Pass 4F UI exposes knowledge without Slack integration', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const text of ['Knowledge Layer', 'Decision Log', 'Living Docs', "Today's Prompts", 'Export Documents']) assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  assert.doesNotMatch(html, /slack\.com\/api|api\.slack\.com/);
});

test('Prompt Library is distinct from the small Today launchpad and supports safe prompt controls', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const text of ['Prompt Library', 'copyPrompt', 'togglePromptFavorite', 'editPrompt', 'deletePrompt', 'last_copied_at', 'recurring_use_label', 'Prompt copied.']) assert.match(html, new RegExp(text.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  assert.match(html, /rows\.filter\(\(row\) => row\.show_today === true\)/);
  assert.match(html, /window\.confirm\('Delete this prompt\?'\)/);
  assert.doesNotMatch(html, /executePrompt|runPrompt|fetch\([^)]*prompt_text/);
});
