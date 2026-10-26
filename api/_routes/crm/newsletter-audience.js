import { allowMethods, bodyOf, sendData, sendError, throwIfError } from '../_lib/http.js';
import { withCommandAuth } from '../_lib/auth.js';
import { getSupabase } from '../_lib/supabase.js';
import { assertExplicitConsent, loadSubscriber, normalizeNewsletterEmail, NEWSLETTER_SEGMENTS, sourceValue, SUBSCRIBER_STATUSES, SUBSCRIPTION_STATUSES, segmentValue, upsertExplicitSubscription } from '../_lib/newsletter.js';
import { enumValue, optionalText, requireUuid } from '../_lib/validation.js';

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) return;
  try {
    const db = getSupabase();
    if (req.method === 'GET') {
      let query = db.from('crm_newsletter_subscribers').select('*, subscriptions:crm_newsletter_subscriptions(*)').order('updated_at', { ascending: false }).limit(250);
      if (req.query.status) query = query.eq('status', enumValue(req.query.status, 'status', SUBSCRIBER_STATUSES));
      if (req.query.email) query = query.eq('email_normalized', normalizeNewsletterEmail(req.query.email));
      const result = await query;
      throwIfError(result.error);
      return sendData(res, result.data || []);
    }
    const input = bodyOf(req);
    const action = input.action || 'subscribe';
    if (action === 'subscribe' || action === 'resubscribe') {
      assertExplicitConsent(input.explicit_consent);
      const result = await upsertExplicitSubscription({ db, email: input.email, fullName: input.full_name, segmentKeys: input.segment_keys, consentSource: input.consent_source });
      return sendData(res, result, 201);
    }
    const subscriberId = requireUuid(input.subscriber_id, 'subscriber_id');
    const subscriber = await loadSubscriber(db, subscriberId);
    if (action === 'unsubscribe_global') {
      const result = await db.from('crm_newsletter_subscribers').update({ status: 'unsubscribed', updated_at: new Date().toISOString() }).eq('id', subscriberId).select().single();
      throwIfError(result.error);
      return sendData(res, result.data);
    }
    if (action === 'unsubscribe_segment') {
      const segment = segmentValue(input.segment_key);
      const result = await db.from('crm_newsletter_subscriptions').update({ status: 'unsubscribed', unsubscribed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('subscriber_id', subscriberId).eq('segment_key', segment).select().single();
      throwIfError(result.error);
      return sendData(res, { subscriber, subscription: result.data });
    }
    return sendError(res, Object.assign(new Error('Unknown audience action'), { code: 'VALIDATION_ERROR' }));
  } catch (error) { return sendError(res, error); }
}

export default withCommandAuth(handler);
