import { withCommandAuth } from '../_lib/auth.js';
import { applicationWorkValues, client, dueDateValue, errorResponse, supabaseError } from '../_lib/work.js';
import { requireUuid } from '../_lib/validation.js';
import { fundingPriorityFields } from '../_lib/funding-priority.js';
import { fundingGroup } from '../_lib/funding-scores.js';

const TYPES = ['grant', 'accelerator', 'pitch_competition', 'procurement', 'funding', 'fellowship', 'program', 'other'];
const STATUSES = ['discovered', 'reviewing', 'apply', 'in_progress', 'submitted', 'awaiting_response', 'interview', 'final_decision', 'awarded', 'not_selected', 'archived'];
const DISMISS_REASONS = ['Not eligible', 'Not enough value', 'Too much effort', 'Wrong timing', 'Not a fit', 'Already applied elsewhere', 'Other'];
const FIELDS = ['opportunity_type', 'title', 'organization', 'account_id', 'contact_id', 'source_url', 'source_type', 'source_id', 'external_program_id', 'amount_value', 'amount_text', 'funding_min_amount', 'funding_max_amount', 'funding_value_text', 'funding_structure', 'is_non_dilutive', 'equity_percent', 'equity_terms_text', 'eligibility', 'fit_notes', 'fit_label', 'fit_rationale', 'priority_label', 'priority_rank', 'effort_level', 'effort_rationale', 'reuse_level', 'application_requirements_json', 'required_partners', 'source_verified_at', 'status', 'deadline_at', 'submitted_at', 'response_expected_at', 'follow_up_at', 'decision_at', 'outcome_notes', 'notes', 'funding_intent'];
function pick(body) { return { ...Object.fromEntries(FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(body || {}, field)).map((field) => [field, body[field]])), ...fundingPriorityFields(body) }; }
function validate(input, partial) { if (!partial && (!input.title || !input.opportunity_type)) return 'title and opportunity_type are required'; if (input.opportunity_type && !TYPES.includes(input.opportunity_type)) return 'invalid opportunity type'; if (input.status && !STATUSES.includes(input.status)) return 'invalid opportunity status'; if (input.funding_intent && input.funding_intent !== 'option') return 'Only Choose to Apply can set funding intent to chosen'; return null; }
async function ensureApplicationWork(db, opportunity) {
  if (opportunity.funding_intent !== 'chosen') return null;
  const existing = await db.from('work_items').select('*').eq('source_type', 'program_opportunity').eq('source_id', opportunity.id).limit(1);
  if (existing.data?.[0]) {
    const item = existing.data[0];
    if (['open', 'in_progress'].includes(item.status)) await db.from('work_items').update(applicationWorkValues(opportunity)).eq('id', item.id);
    return item;
  }
  const { data, error } = await db.from('work_items').insert({ ...applicationWorkValues(opportunity), category: 'grant', status: 'open', priority: 'next', owner_type: 'founder', owner_name: null, source_type: 'program_opportunity', source_id: opportunity.id }).select().single();
  if (error) throw error;
  return data;
}
async function dismissOpportunity(db, body) {
  if (!body.id) return { error: { code: 'VALIDATION_ERROR', message: 'id is required' } };
  if (!DISMISS_REASONS.includes(body.dismissed_reason)) return { error: { code: 'VALIDATION_ERROR', message: 'Choose a valid dismissal reason' } };
  const existing = await db.from('crm_program_opportunities').select('*').eq('id', body.id).single();
  if (existing.error) return { error: existing.error };
  if (['submitted', 'awaiting_response', 'interview', 'final_decision', 'awarded', 'not_selected'].includes(existing.data.status)) return { error: { code: 'DISMISS_SUBMITTED_LOCKED', message: 'Submitted application history cannot be dismissed from Funding Hub.' } };
  const linked = await db.from('command_applications').select('id,status').eq('program_opportunity_id', body.id).in('status', ['submitted', 'awaiting_response', 'interview', 'awarded', 'not_selected']).limit(1);
  if (linked.error) return { error: linked.error };
  if (linked.data?.[0]) return { error: { code: 'DISMISS_SUBMITTED_LOCKED', message: 'This opportunity has submitted application history and cannot be dismissed.' } };
  const result = await db.from('crm_program_opportunities').update({ status: 'archived', dismissed_reason: body.dismissed_reason, dismissed_note: typeof body.dismissed_note === 'string' ? body.dismissed_note.trim() : null, dismissed_at: new Date().toISOString(), dismissed_by_user: true, updated_at: new Date().toISOString() }).eq('id', body.id).select().single();
  if (result.error) return { error: result.error };
  return { data: result.data };
}
async function restoreOpportunity(db, body) {
  if (!body.id) return { error: { code: 'VALIDATION_ERROR', message: 'id is required' } };
  const existing = await db.from('crm_program_opportunities').select('*').eq('id', body.id).single();
  if (existing.error) return { error: existing.error };
  if (existing.data.status !== 'archived' || !existing.data.dismissed_by_user) return { error: { code: 'RESTORE_NOT_DISMISSED', message: 'Only a dismissed opportunity can be restored.' } };
  const result = await db.from('crm_program_opportunities').update({ status: 'reviewing', funding_intent: existing.data.funding_intent === 'chosen' ? 'option' : existing.data.funding_intent, updated_at: new Date().toISOString() }).eq('id', body.id).select().single();
  if (result.error) return { error: result.error };
  return { data: result.data };
}

async function handler(req, res) {
  try {
    const db = client();
    if (req.method === 'GET') {
      let query = db.from('crm_program_opportunities').select('*, crm_accounts(name), crm_contacts(full_name,email)').order('deadline_at', { ascending: true, nullsFirst: false });
      if (req.query?.status) query = query.eq('status', req.query.status);
      const { data, error } = await query; if (error) return supabaseError(res, error);
      const opportunities = data || [];
      const ids = opportunities.map((opportunity) => opportunity.id);
      const work = ids.length ? (await db.from('work_items').select('id,title,due_at,status,source_id').eq('source_type', 'program_opportunity').in('source_id', ids).not('status', 'in', '(done,cancelled)')).data || [] : [];
      const applications = ids.length ? (await db.from('command_applications').select('id,program_opportunity_id,title,status,submitted_at').in('program_opportunity_id', ids)).data || [] : [];
      const prep = ids.length ? (await db.from('command_funding_prep_items').select('*').in('opportunity_id', ids).order('sort')).data || [] : [];
      return res.status(200).json({ ok: true, data: opportunities.map((opportunity) => ({ ...opportunity, funding_group: fundingGroup(opportunity), prep_items: prep.filter((p) => p.opportunity_id === opportunity.id), linked_application: applications.find((app) => app.program_opportunity_id === opportunity.id) || null, next_work_item: work.find((item) => item.source_id === opportunity.id) || null })) });
    }
    if (req.method === 'DELETE') {
      requireUuid(req.query?.id, 'id');
      const linked = await db.from('work_items').select('id,status').eq('source_type', 'program_opportunity').eq('source_id', req.query.id).limit(1);
      if (linked.error) return supabaseError(res, linked.error);
      if (linked.data?.length) return res.status(409).json({ ok: false, error: { code: 'OPPORTUNITY_HAS_LINKED_WORK', message: 'This opportunity still has linked Work. Complete or remove that Work before deleting the opportunity.' } });
      const { error } = await db.from('crm_program_opportunities').delete().eq('id', req.query.id);
      if (error) return supabaseError(res, error);
      return res.status(200).json({ ok: true, data: { deleted: true } });
    }
    if (!['POST', 'PATCH'].includes(req.method)) return res.status(405).json({ ok: false, error: { message: 'Method not allowed' } });
    const body = req.body || {};
    if (req.method === 'POST' && body.action === 'prep_toggle') {
      if (!body.id) return errorResponse(res, 400, 'id is required');
      const { data, error } = await db.from('command_funding_prep_items').update({ done_at: body.done ? new Date().toISOString() : null }).eq('id', body.id).select().single();
      if (error) return supabaseError(res, error);
      return res.status(200).json({ ok: true, data });
    }
    if (req.method === 'POST' && body.action === 'dismiss') { const result = await dismissOpportunity(db, body); if (result.error) return result.error.code === 'VALIDATION_ERROR' ? errorResponse(res, 400, result.error.message) : result.error.code === 'DISMISS_SUBMITTED_LOCKED' ? res.status(409).json({ ok: false, error: result.error }) : supabaseError(res, result.error); return res.status(200).json({ ok: true, data: result.data }); }
    if (req.method === 'POST' && body.action === 'restore') { const result = await restoreOpportunity(db, body); if (result.error) return result.error.code === 'VALIDATION_ERROR' ? errorResponse(res, 400, result.error.message) : result.error.code === 'RESTORE_NOT_DISMISSED' ? res.status(409).json({ ok: false, error: result.error }) : supabaseError(res, result.error); return res.status(200).json({ ok: true, data: result.data }); }
    const input = pick(body); if (Object.prototype.hasOwnProperty.call(input, 'deadline_at')) input.deadline_at = dueDateValue(input.deadline_at); const invalid = validate(input, req.method === 'PATCH'); if (invalid) return errorResponse(res, 400, invalid);
    if (req.method === 'PATCH') { if (!body.id) return errorResponse(res, 400, 'id is required'); const { data, error } = await db.from('crm_program_opportunities').update(input).eq('id', body.id).select().single(); if (error) return supabaseError(res, error); await ensureApplicationWork(db, data); return res.status(200).json({ ok: true, data }); }
    const { data, error } = await db.from('crm_program_opportunities').insert({ ...input, title: input.title.trim() }).select().single(); if (error) return supabaseError(res, error); await ensureApplicationWork(db, data); return res.status(201).json({ ok: true, data });
  } catch (error) { return supabaseError(res, error); }
}
export default withCommandAuth(handler);
