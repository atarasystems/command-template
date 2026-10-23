import { withCommandAuth } from '../_lib/auth.js';
import { buildOutreachContext, generateOutreachPrep } from '../_lib/business-development.js';
import { getSupabase } from '../_lib/supabase.js';
import { founderSettings } from '../_lib/founder-settings.js';
import { requireUuid } from '../_lib/validation.js';

export const maxDuration = 30;

async function loadOpportunity(db, id) {
  requireUuid(id, 'opportunity_id');
  const result = await db.from('crm_opportunities').select('*, account:crm_accounts(id,name), contact:crm_contacts(id,full_name,first_name,last_name,email,job_title)').eq('id', id).is('deleted_at', null).single();
  if (result.error) {
    if (result.error.code === 'PGRST116') {
      const error = new Error('This opportunity is no longer available for outreach preparation');
      error.code = 'VALIDATION_ERROR';
      throw error;
    }
    throw result.error;
  }
  if (['lost', 'not_now', 'do_not_contact'].includes(result.data.stage) || result.data.closed_at) {
    const error = new Error('This opportunity is not available for outreach preparation');
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  return result.data;
}

async function loadActivities(db, opportunityId) {
  const result = await db.from('crm_activities').select('activity_type,subject,description,occurred_at').eq('opportunity_id', opportunityId).order('occurred_at', { ascending: false }).limit(8);
  if (result.error) throw result.error;
  return result.data || [];
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  try {
    const opportunityId = req.body?.opportunity_id;
    const db = getSupabase();
    const opportunity = await loadOpportunity(db, opportunityId);
    const context = buildOutreachContext(opportunity, await loadActivities(db, opportunity.id));
    const prep = await generateOutreachPrep(context, { settings: await founderSettings(db) });
    return res.status(200).json({ ok: true, data: { account_name: context.account, contact_name: context.contact, ...prep, generated_at: new Date().toISOString() } });
  } catch (error) {
    if (error?.code === 'VALIDATION_ERROR' || error?.code === '22P02') return res.status(400).json({ ok: false, error: { code: error.code, message: error.message } });
    console.error('[Business Development]', error.message);
    return res.status(500).json({ ok: false, error: { code: 'BUSINESS_DEVELOPMENT_FAILED', message: 'Outreach prep could not be prepared.' } });
  }
}

export default withCommandAuth(handler);
