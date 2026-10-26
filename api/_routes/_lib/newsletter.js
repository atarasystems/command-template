import { getSupabase } from './supabase.js';
import { emailValue, enumValue, fail, optionalText, requireUuid } from './validation.js';

export const NEWSLETTER_SEGMENTS = ['atara_general', 'smb_ai', 'seo_geo', 'training_partners', 'clients_alumni', 'organizations_ai'];
export const NEWSLETTER_SOURCES = ['website_signup', 'newsletter_signup', 'training_registration', 'event_registration', 'client_onboarding', 'atara_audits_opt_in', 'manual_explicit_permission'];
export const PUBLIC_NEWSLETTER_SOURCES = ['website_signup', 'newsletter_signup', 'training_registration', 'event_registration'];
export const SUBSCRIBER_STATUSES = ['subscribed', 'unsubscribed', 'suppressed', 'bounced', 'invalid'];
export const SUBSCRIPTION_STATUSES = ['subscribed', 'unsubscribed', 'suppressed'];

export function normalizeNewsletterEmail(value) {
  return emailValue(value, false);
}

export function segmentValue(value) {
  return enumValue(value, 'segment_key', NEWSLETTER_SEGMENTS);
}

export function sourceValue(value) {
  return enumValue(value, 'consent_source', NEWSLETTER_SOURCES);
}

export function assertExplicitConsent(value) {
  if (value !== true) fail('Explicit consent is required');
  return true;
}

export function assertPublicSource(value) {
  const source = sourceValue(value);
  if (!PUBLIC_NEWSLETTER_SOURCES.includes(source)) fail('Public signup requires a public consent source');
  return source;
}

export function silentPublicBlock(message = 'Signup accepted') {
  const error = new Error(message);
  error.code = 'NEWSLETTER_SILENT_ACCEPT';
  return error;
}

export async function exactContactIdForEmail(db, email) {
  const result = await db.from('crm_contacts').select('id').ilike('email', email).limit(2);
  if (result.error) throw result.error;
  return result.data?.length === 1 ? result.data[0].id : null;
}

export async function crmSuppressionForEmail(db, email) {
  const result = await db.from('crm_suppressions').select('email,reason').ilike('email', email).maybeSingle();
  if (result.error) throw result.error;
  return result.data || null;
}

export async function loadSubscriber(db, id) {
  requireUuid(id, 'subscriber_id');
  const result = await db.from('crm_newsletter_subscribers').select('*, subscriptions:crm_newsletter_subscriptions(*)').eq('id', id).single();
  if (result.error) throw result.error;
  return result.data;
}

export async function upsertExplicitSubscription({ db = getSupabase(), email, fullName, segmentKeys, consentSource, now = new Date().toISOString(), publicRequest = false }) {
  const normalizedEmail = normalizeNewsletterEmail(email);
  if (!Array.isArray(segmentKeys) || !segmentKeys.length) fail('At least one segment is required');
  const segments = [...new Set(segmentKeys)].map(segmentValue);
  const source = sourceValue(consentSource);
  const suppression = await crmSuppressionForEmail(db, normalizedEmail);
  if (suppression) {
    if (publicRequest) throw silentPublicBlock();
    fail('This email is suppressed and requires review');
  }

  const existing = await db.from('crm_newsletter_subscribers').select('*').eq('email_normalized', normalizedEmail).maybeSingle();
  if (existing.error) throw existing.error;
  let subscriber = existing.data;
  if (subscriber && ['suppressed', 'bounced', 'invalid'].includes(subscriber.status)) {
    if (publicRequest) throw silentPublicBlock();
    fail('This subscriber requires review before resubscription');
  }
  if (!subscriber) {
    const inserted = await db.from('crm_newsletter_subscribers').insert({
      email: normalizedEmail,
      email_normalized: normalizedEmail,
      full_name: optionalText(fullName, 'full_name', 300),
      contact_id: await exactContactIdForEmail(db, normalizedEmail),
      status: 'subscribed',
    }).select().single();
    if (inserted.error) throw inserted.error;
    subscriber = inserted.data;
  } else {
    const updated = await db.from('crm_newsletter_subscribers').update({
      full_name: fullName === undefined ? subscriber.full_name : optionalText(fullName, 'full_name', 300),
      status: 'subscribed',
      updated_at: now,
    }).eq('id', subscriber.id).select().single();
    if (updated.error) throw updated.error;
    subscriber = updated.data;
  }

  const memberships = [];
  for (const segmentKey of segments) {
    const current = await db.from('crm_newsletter_subscriptions').select('id').eq('subscriber_id', subscriber.id).eq('segment_key', segmentKey).maybeSingle();
    if (current.error) throw current.error;
    const values = { subscriber_id: subscriber.id, segment_key: segmentKey, status: 'subscribed', consent_source: source, consented_at: now, unsubscribed_at: null, updated_at: now };
    const result = current.data
      ? await db.from('crm_newsletter_subscriptions').update(values).eq('id', current.data.id).select().single()
      : await db.from('crm_newsletter_subscriptions').insert(values).select().single();
    if (result.error) throw result.error;
    memberships.push(result.data);
  }
  return { subscriber, subscriptions: memberships };
}

export async function assertEligibleForNewsletter({ db = getSupabase(), subscriber, subscription }) {
  if (!subscriber || !subscription || subscriber.status !== 'subscribed' || subscription.status !== 'subscribed' || !subscription.consented_at) return false;
  try {
    if (!subscriber.email_normalized || normalizeNewsletterEmail(subscriber.email_normalized) !== subscriber.email_normalized) return false;
  } catch (_) { return false; }
  if (['suppressed', 'bounced', 'invalid', 'unsubscribed'].includes(subscriber.status)) return false;
  return !(await crmSuppressionForEmail(db, subscriber.email_normalized));
}
