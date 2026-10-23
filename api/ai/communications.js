import { withCommandAuth } from '../_lib/auth.js';
import { insertRow } from '../_lib/records.js';
import { getSupabase } from '../_lib/supabase.js';
import { generateCommunicationDraft, buildCommunicationContext, COMMUNICATION_PURPOSES, draftTypeForPurpose } from '../_lib/communications.js';
import { founderSettings } from '../_lib/founder-settings.js';
import { requireUuid } from '../_lib/validation.js';

async function loadContext(db, { opportunityId, contactId, purpose }) {
  let opportunity = {};
  let contact = {};
  let account = {};
  if (opportunityId) {
    requireUuid(opportunityId, 'opportunity_id');
    const result = await db.from('crm_opportunities').select('*, account:crm_accounts(id,name), contact:crm_contacts(id,full_name,first_name,last_name,email,job_title,linkedin_url,notes,next_action,next_action_at,account_id)').eq('id', opportunityId).is('deleted_at', null).single();
    if (result.error) throw result.error;
    opportunity = result.data;
    account = opportunity.account || {};
    contact = opportunity.contact || {};
  } else if (contactId) {
    requireUuid(contactId, 'contact_id');
    const result = await db.from('crm_contacts').select('*, account:crm_accounts(id,name)').eq('id', contactId).single();
    if (result.error) throw result.error;
    contact = result.data;
    account = contact.account || {};
  }
  if (contactId && contact.id !== contactId) {
    const error = new Error('The selected contact is not linked to this opportunity');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  const activityQuery = db.from('crm_activities').select('activity_type,subject,description,occurred_at').order('occurred_at', { ascending: false }).limit(6);
  const activityResult = opportunity.id
    ? await activityQuery.eq('opportunity_id', opportunity.id)
    : await activityQuery.eq('contact_id', contact.id);
  if (activityResult.error) throw activityResult.error;
  return { opportunity, contact, account, activities: activityResult.data || [], purpose };
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  try {
    const body = req.body || {};
    const purpose = body.purpose;
    if (!COMMUNICATION_PURPOSES.includes(purpose)) return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Unsupported communication purpose' } });
    if (!body.opportunity_id && !body.contact_id) return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'opportunity_id or contact_id is required' } });
    const db = getSupabase();
    const source = await loadContext(db, { opportunityId: body.opportunity_id, contactId: body.contact_id, purpose });

    const context = buildCommunicationContext(source);
    const draft = await generateCommunicationDraft(context, { settings: await founderSettings(db) });

    const saved = await insertRow('crm_email_drafts', {
      opportunity_id: source.opportunity.id || null,
      account_id: source.account.id || source.contact.account_id || null,
      contact_id: source.contact.id || null,
      to_email: source.contact.email || null,
      subject: draft.subject,
      body: draft.body,
      draft_type: draftTypeForPurpose(purpose),
      status: 'needs_review',
      drafted_by: 'Command email helper',
      needs_human: true,
      human_reason: 'Founder review required before sending',
    });
    return res.status(201).json({ ok: true, data: {
      draft_id: saved.id,
      purpose,
      account_name: source.account.name || null,
      contact_name: source.contact.full_name || [source.contact.first_name, source.contact.last_name].filter(Boolean).join(' ') || null,
      subject: draft.subject,
      body: draft.body,
      do_not_claim: draft.do_not_claim,
      grounding_note: draft.grounding_note,
    } });
  } catch (error) {
    if (error?.code === 'VALIDATION_ERROR' || error?.code === '22P02') return res.status(400).json({ ok: false, error: { code: error.code, message: error.message } });
    if (error?.code === 'AI_NOT_CONFIGURED') return res.status(503).json({ ok: false, error: { code: error.code, message: error.message } });
    console.error('[Communications]', error.message);
    return res.status(500).json({ ok: false, error: { code: 'COMMUNICATION_PREP_FAILED', message: 'Communication preparation could not be completed.' } });
  }
}

export default withCommandAuth(handler);
