import { allowMethods, bodyOf, sendData, sendError, throwIfError } from '../_lib/http.js';
import { withCommandAuth } from '../_lib/auth.js';
import { getRow, listRows, updateRow } from '../_lib/records.js';
import { getSupabase } from '../_lib/supabase.js';
import {
  LEAD_SOURCES, OFFERS, PIPELINES, QUALIFICATION_GRADES, STAGES, TRIGGERS,
  booleanValue, dateValue, emailValue, domainFromWebsite, enumValue, moneyValue, optionalText, optionalUuid,
  pickDefined, requiredText, timestampValue, requireUuid,
} from '../_lib/validation.js';

const detailSelect = '*, account:crm_accounts(*), contact:crm_contacts(*)';
const editable = {
  account_id: value => optionalUuid(value, 'account_id'),
  contact_id: value => optionalUuid(value, 'contact_id'),
  pipeline: value => enumValue(value, 'pipeline', PIPELINES),
  lead_source: value => enumValue(value, 'lead_source', LEAD_SOURCES),
  trigger_type: value => enumValue(value, 'trigger_type', TRIGGERS, true),
  offer_type: value => enumValue(value, 'offer_type', OFFERS),
  stage: value => enumValue(value, 'stage', STAGES),
  problem_spotted: value => optionalText(value, 'problem_spotted'),
  research_notes: value => optionalText(value, 'research_notes'),
  personalization_angle: value => optionalText(value, 'personalization_angle'),
  evidence: value => optionalText(value, 'evidence'),
  evidence_url: value => optionalText(value, 'evidence_url', 2000),
  qualification_grade: value => enumValue(value, 'qualification_grade', QUALIFICATION_GRADES, true),
  outreach_path: value => optionalText(value, 'outreach_path', 2000),
  search_query: value => optionalText(value, 'search_query', 2000),
  announcement_date: value => dateValue(value, 'announcement_date'),
  contact_form_url: value => optionalText(value, 'contact_form_url', 2000),
  opportunity_value: value => moneyValue(value, 'opportunity_value'),
  amount_paid: value => moneyValue(value, 'amount_paid', false),
  last_contacted_at: value => timestampValue(value, 'last_contacted_at'),
  next_action_at: value => timestampValue(value, 'next_action_at'),
  next_action: value => optionalText(value, 'next_action', 1000),
  auto_followups_enabled: value => booleanValue(value, 'auto_followups_enabled'),
  needs_human: value => booleanValue(value, 'needs_human'),
  human_reason: value => optionalText(value, 'human_reason', 1000),
  gmail_thread_id: value => optionalText(value, 'gmail_thread_id', 500),
  gmail_message_id: value => optionalText(value, 'gmail_message_id', 500),
  audit_id: value => optionalText(value, 'audit_id', 500),
  closed_at: value => timestampValue(value, 'closed_at'),
  lost_reason: value => optionalText(value, 'lost_reason', 2000),
};

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;
  try {
    if (req.method === 'GET') {
      if (req.query.id) {
        const id = requireUuid(req.query.id, 'id');
        const { data, error } = await getSupabase().from('crm_opportunities').select(detailSelect).eq('id', id).is('deleted_at', null).single();
        throwIfError(error);
        return sendData(res, data);
      }
      const filters = [['stage', req.query.stage], ['lead_source', req.query.lead_source], ['account_id', req.query.account_id], ['contact_id', req.query.contact_id]];
      return sendData(res, await listRows('crm_opportunities', req.query, { select: detailSelect, filters, isNull: ['deleted_at'] }));
    }

    if (req.method === 'DELETE') {
      const id = req.query.id;
      requireUuid(id, 'id');
      const { error } = await getSupabase().from('crm_opportunities').update({ deleted_at: new Date().toISOString() }).eq('id', id);
      throwIfError(error);
      return sendData(res, { deleted: true });
    }

    const input = bodyOf(req);
    if (req.method === 'PATCH') {
      const id = requireUuid(req.query.id);
      const current = await getRow('crm_opportunities', id, 'id,account_id,contact_id,deleted_at');
      if (current.deleted_at) {
        const error = new Error('This opportunity is no longer available');
        error.code = 'NOT_FOUND';
        throw error;
      }
      const db = getSupabase();
      const opportunityInput = pickDefined(input, editable);
      const hasBusinessName = Object.hasOwn(input, 'business_name');
      const hasContactName = Object.hasOwn(input, 'contact_name');
      const hasEmail = Object.hasOwn(input, 'email');
      let accountId = current.account_id;
      let contactId = current.contact_id;

      if (hasBusinessName) {
        const businessName = requiredText(input.business_name, 'business_name', 300);
        if (accountId) {
          const { error } = await db.from('crm_accounts').update({ name: businessName }).eq('id', accountId);
          throwIfError(error);
        } else {
          const { data, error } = await db.from('crm_accounts').insert({ name: businessName, account_type: 'business' }).select('id').single();
          throwIfError(error);
          accountId = data.id;
          opportunityInput.account_id = accountId;
        }
      }

      if (hasContactName || hasEmail) {
        const contactName = hasContactName ? optionalText(input.contact_name, 'contact_name', 300) : undefined;
        const email = hasEmail ? emailValue(input.email, true) : undefined;
        if (contactId) {
          const contactInput = {};
          if (hasContactName) contactInput.full_name = contactName;
          if (hasEmail) contactInput.email = email;
          const { error } = await db.from('crm_contacts').update(contactInput).eq('id', contactId);
          throwIfError(error);
        } else if (contactName || email) {
          const { data, error } = await db.from('crm_contacts').insert({
            account_id: accountId,
            full_name: contactName || null,
            email: email || null,
            is_primary: true,
          }).select('id').single();
          throwIfError(error);
          contactId = data.id;
          opportunityInput.contact_id = contactId;
        }
      }

      const updated = Object.keys(opportunityInput).length
        ? await updateRow('crm_opportunities', id, opportunityInput, detailSelect)
        : await getRow('crm_opportunities', id, detailSelect);
      return sendData(res, updated);
    }

    const website = optionalText(input.website, 'website', 2000);
    const rpcInput = {
      business_name: requiredText(input.business_name, 'business_name', 300),
      website,
      domain: domainFromWebsite(website),
      contact_name: optionalText(input.contact_name, 'contact_name', 300),
      email: input.email === undefined || input.email === '' ? null : input.email,
      contact_title: optionalText(input.contact_title, 'contact_title', 300),
      linkedin_url: optionalText(input.linkedin_url, 'linkedin_url', 2000),
      alignable_url: optionalText(input.alignable_url, 'alignable_url', 2000),
      city: optionalText(input.city, 'city', 200),
      state: optionalText(input.state, 'state', 100),
      pipeline: enumValue(input.pipeline, 'pipeline', PIPELINES),
      lead_source: enumValue(input.lead_source, 'lead_source', LEAD_SOURCES),
      trigger_type: enumValue(input.trigger_type, 'trigger_type', TRIGGERS, true),
      offer_type: enumValue(input.offer_type, 'offer_type', OFFERS),
      problem_spotted: optionalText(input.problem_spotted, 'problem_spotted'),
      research_notes: optionalText(input.research_notes, 'research_notes'),
      personalization_angle: optionalText(input.personalization_angle, 'personalization_angle'),
      evidence: optionalText(input.evidence, 'evidence'),
      evidence_url: optionalText(input.evidence_url, 'evidence_url', 2000),
      qualification_grade: enumValue(input.qualification_grade, 'qualification_grade', QUALIFICATION_GRADES, true),
      outreach_path: optionalText(input.outreach_path, 'outreach_path', 2000),
      search_query: optionalText(input.search_query, 'search_query', 2000),
      announcement_date: dateValue(input.announcement_date, 'announcement_date'),
      contact_form_url: optionalText(input.contact_form_url, 'contact_form_url', 2000),
      opportunity_value: moneyValue(input.opportunity_value, 'opportunity_value'),
    };
    if (Object.hasOwn(input, 'auto_followups_enabled')) {
      rpcInput.auto_followups_enabled = booleanValue(input.auto_followups_enabled, 'auto_followups_enabled');
    }
    if (rpcInput.email) rpcInput.email = emailValue(rpcInput.email, false);
    const { data, error } = await getSupabase().rpc('crm_create_opportunity', { input: rpcInput });
    throwIfError(error);
    return sendData(res, data, 201);
  } catch (error) {
    return sendError(res, error);
  }
}

export default withCommandAuth(handler);
