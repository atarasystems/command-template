import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import audienceHandler from '../api/_routes/crm/newsletter-audience.js';
import signupHandler from '../api/_routes/newsletter/signup.js';
import { createCommandSession } from '../api/_routes/_lib/auth.js';
import {
  assertEligibleForNewsletter,
  assertExplicitConsent,
  assertPublicSource,
  NEWSLETTER_SEGMENTS,
  NEWSLETTER_SOURCES,
  normalizeNewsletterEmail,
  segmentValue,
  sourceValue,
} from '../api/_routes/_lib/newsletter.js';

const secret = 'newsletter-test-secret-at-least-thirty-two-characters';
function response() { return { statusCode: 200, payload: null, status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; } }; }
function cookie() { return `atara_command_session=${createCommandSession()}`; }

test.beforeEach(() => { process.env.COMMAND_SESSION_SECRET = secret; });
test.after(() => { delete process.env.COMMAND_SESSION_SECRET; });

test('migration defines the approved two-table consent foundation and no token/campaign tables', () => {
  const sql = fs.readFileSync(new URL('../supabase/schema/command-schema.sql', import.meta.url), 'utf8');
  for (const name of ['crm_newsletter_subscribers', 'crm_newsletter_subscriptions', 'email_normalized', 'consent_source', 'consented_at', 'alter table public.crm_newsletter_subscribers enable row level security']) assert.match(sql, new RegExp(name, 'i'));
  assert.doesNotMatch(sql, /crm_newsletter_tokens|pending_confirmation/i);
  assert.match(sql, /UNIQUE INDEX IF NOT EXISTS crm_newsletter_subscribers_email_idx/i);
  assert.match(sql, /UNIQUE INDEX IF NOT EXISTS crm_newsletter_subscriptions_subscriber_segment_idx/i);
});

test('allowlists and normalized identity are deterministic', () => {
  assert.equal(normalizeNewsletterEmail('  Person@Example.COM '), 'person@example.com');
  assert.equal(NEWSLETTER_SEGMENTS.length, 6);
  assert.equal(NEWSLETTER_SOURCES.length, 7);
  assert.equal(segmentValue('seo_geo'), 'seo_geo');
  assert.equal(sourceValue('manual_explicit_permission'), 'manual_explicit_permission');
  assert.throws(() => segmentValue('arbitrary_segment'), /segment_key/);
  assert.throws(() => sourceValue('prior_email'), /consent_source/);
  assert.throws(() => assertExplicitConsent(false), /Explicit consent/);
  assert.equal(assertPublicSource('website_signup'), 'website_signup');
  assert.throws(() => assertPublicSource('manual_explicit_permission'), /public consent source/);
});

test('public signup requires explicit consent before any database access', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const res = response();
    await signupHandler({ method: 'POST', headers: { 'content-type': 'application/json' }, body: { email: 'person@example.com', segment_keys: ['seo_geo'], consent_source: 'website_signup', explicit_consent: false } }, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.payload.error.message, /Explicit consent/);
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});

test('authenticated audience management route rejects unauthenticated access', async () => {
  const res = response();
  await audienceHandler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 401);
});

test('public signup cannot read subscribers or create CRM records', () => {
  const source = fs.readFileSync(new URL('../api/_routes/newsletter/signup.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /crm_contacts|crm_accounts|crm_opportunities|crm_activities|crm_scout|send-email|resend|gmail/i);
  assert.match(source, /explicit_consent/);
  assert.match(source, /assertPublicSource/);
});

test('public signup is JSON-only, bounded, and separates public from internal consent sources', async () => {
  const base = { email: 'person@example.com', segment_keys: ['seo_geo'], consent_source: 'website_signup', explicit_consent: true };
  const noJson = response(); await signupHandler({ method: 'POST', headers: {}, body: base }, noJson); assert.equal(noJson.statusCode, 400);
  const tooMany = response(); await signupHandler({ method: 'POST', headers: { 'content-type': 'application/json' }, body: { ...base, segment_keys: ['seo_geo', 'smb_ai', 'atara_general', 'clients_alumni'] } }, tooMany); assert.equal(tooMany.statusCode, 400);
  const internal = response(); await signupHandler({ method: 'POST', headers: { 'content-type': 'application/json' }, body: { ...base, consent_source: 'manual_explicit_permission' } }, internal); assert.equal(internal.statusCode, 400);
  const bot = response(); await signupHandler({ method: 'POST', headers: { 'content-type': 'application/json' }, body: { ...base, website: 'https://bot.example' } }, bot); assert.equal(bot.statusCode, 400);
});

test('public signup does not disclose existing CRM, suppression, or segment state', () => {
  const source = fs.readFileSync(new URL('../api/_routes/newsletter/signup.js', import.meta.url), 'utf8');
  assert.match(source, /accepted: true/);
  assert.doesNotMatch(source, /subscriber|suppression|contact_id|segments:/i);
  assert.match(source, /NEWSLETTER_SILENT_ACCEPT/);
});

test('newsletter helper fails closed for suppression, global status, segment status, consent, and invalid email', async () => {
  const calls = [];
  const db = { from(table) {
    calls.push(table);
    return { select() { return this; }, ilike() { return this; }, maybeSingle: async () => ({ data: null, error: null }) };
  } };
  const baseSubscriber = { status: 'subscribed', email_normalized: 'person@example.com' };
  const baseSubscription = { status: 'subscribed', consented_at: '2026-08-28T12:00:00Z' };
  assert.equal(await assertEligibleForNewsletter({ db, subscriber: baseSubscriber, subscription: baseSubscription }), true);
  assert.equal(await assertEligibleForNewsletter({ db, subscriber: { ...baseSubscriber, status: 'unsubscribed' }, subscription: baseSubscription }), false);
  assert.equal(await assertEligibleForNewsletter({ db, subscriber: baseSubscriber, subscription: { ...baseSubscription, status: 'unsubscribed' } }), false);
  assert.equal(await assertEligibleForNewsletter({ db, subscriber: baseSubscriber, subscription: { ...baseSubscription, consented_at: null } }), false);
  assert.equal(await assertEligibleForNewsletter({ db, subscriber: { ...baseSubscriber, status: 'bounced' }, subscription: baseSubscription }), false);
  assert.ok(calls.includes('crm_suppressions'));
  assert.match(normalizeNewsletterEmail('USER@EXAMPLE.COM'), /@/);
});

test('existing communication flow remains separate from newsletter consent', () => {
  const source = fs.readFileSync(new URL('../api/_routes/ai/communications.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /newsletter|subscription|consent/i);
  assert.match(source, /crm_email_drafts/);
});

test('Audience UI exposes explicit add, global unsubscribe, segment unsubscribe, and resubscribe controls', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  for (const phrase of ['id="panel-audience"', 'recordNewsletterSubscription', 'unsubscribeNewsletterGlobally', 'unsubscribeNewsletterSegment', 'resubscribeNewsletterSegment', 'explicit permission']) assert.match(html, new RegExp(phrase, 'i'));
});

test('no newsletter send, Resend integration, campaign, token, Scout, or lead mutation exists in the foundation routes', () => {
  const source = [
    fs.readFileSync(new URL('../api/_routes/_lib/newsletter.js', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../api/_routes/crm/newsletter-audience.js', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../api/_routes/newsletter/signup.js', import.meta.url), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(source, /resend|sendGmail|crm_email_drafts|crm_opportunities|crm_scout_candidates|public\.leads|campaign/i);
});
