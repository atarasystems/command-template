import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { withCommandAuth } from '../_lib/auth.js';
import { getSupabase } from '../_lib/supabase.js';
import { insertRow, listRows, updateRow, getRow } from '../_lib/records.js';
import { emailValue, enumValue, optionalText, optionalUuid, timestampValue, booleanValue, integerValue, pickDefined } from '../_lib/validation.js';
import { sendGmailMessage } from '../send-email.js';
import { assertFounderEmailStyle } from '../_lib/email-style.js';
import { founderSettings } from '../_lib/founder-settings.js';

const STATUSES = ['draft','needs_review','needs_update','approved','ready_to_send','waiting_for_reply','sent','cancelled'];
const TYPES = ['sales','networking','client','audit_partner','grant','program','follow_up','customer_update','general'];
const EMAIL_DESK_ACTIVE_STATUSES = ['draft','needs_review','needs_update','approved','ready_to_send'];
const EMAIL_DESK_HISTORY_STATUSES = ['sent','cancelled'];
const EMAIL_DESK_PAGE_SIZE = 250;
const EMAIL_DESK_HISTORY_LIMIT = 100;
const editable = {
  opportunity_id: value => optionalUuid(value, 'opportunity_id'), account_id: value => optionalUuid(value, 'account_id'), contact_id: value => optionalUuid(value, 'contact_id'),
  gmail_thread_id: value => optionalText(value, 'gmail_thread_id', 500), gmail_message_id: value => optionalText(value, 'gmail_message_id', 500),
  to_email: value => emailValue(value), cc_email: value => optionalText(value, 'cc_email', 2000), subject: value => optionalText(value, 'subject', 500), body: value => optionalText(value, 'body', 50000),
  draft_type: value => enumValue(value, 'draft_type', TYPES), status: value => enumValue(value, 'status', STATUSES), drafted_by: value => optionalText(value, 'drafted_by', 200),
  needs_human: value => booleanValue(value, 'needs_human'), human_reason: value => optionalText(value, 'human_reason', 2000), audience_type: value => optionalText(value, 'audience_type', 200),
  audience_definition: value => value ?? {}, recipient_count: value => value === null || value === undefined ? null : integerValue(value, 'recipient_count'), scheduled_for: value => timestampValue(value, 'scheduled_for'),
};

async function loadAllActiveEmailDeskDrafts(db) {
  const rows = [];
  for (let from = 0; ; from += EMAIL_DESK_PAGE_SIZE) {
    const result = await db.from('crm_email_drafts')
      .select('*')
      .in('status', EMAIL_DESK_ACTIVE_STATUSES)
      .order('updated_at', { ascending: false })
      .range(from, from + EMAIL_DESK_PAGE_SIZE - 1);
    if (result.error) throw result.error;
    const page = result.data || [];
    rows.push(...page);
    if (page.length < EMAIL_DESK_PAGE_SIZE) break;
  }
  return rows;
}

async function loadEmailDeskRows(db) {
  const active = await loadAllActiveEmailDeskDrafts(db);
  const historyResult = await db.from('crm_email_drafts')
    .select('*')
    .in('status', EMAIL_DESK_HISTORY_STATUSES)
    .order('updated_at', { ascending: false })
    .limit(EMAIL_DESK_HISTORY_LIMIT);
  if (historyResult.error) throw historyResult.error;
  return [...active, ...(historyResult.data || [])];
}

async function blockedBySuppression(db, email) {
  if (!email) return null;
  const result = await db.from('crm_suppressions').select('id,reason').ilike('email', email).limit(1);
  if (result.error) throw result.error;
  return result.data?.[0] || null;
}

function draftAttachments(draft) {
  const rows = draft?.audience_definition?.attachments;
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 5).map((row) => ({
    name: typeof row?.name === 'string' ? row.name.trim() : '',
    type: typeof row?.type === 'string' ? row.type.trim() : 'application/octet-stream',
    data: typeof row?.data === 'string' ? row.data.trim() : '',
  })).filter((row) => row.name && row.type && row.data && row.data.length <= 20_000_000);
}

// After a send, the linked opportunity records the contact and waits for a reply.
async function updateOpportunityAfterSend(db, draft, gmailResult, sentAt) {
  if (!draft.opportunity_id) return;
  const result = await db.from('crm_opportunities').select('id,stage').eq('id', draft.opportunity_id).is('deleted_at', null).maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) return;
  const update = await db.from('crm_opportunities').update({
    stage: ['new', 'researching', 'ready_for_review', 'approved_to_send'].includes(result.data.stage) ? 'contacted' : result.data.stage,
    last_contacted_at: sentAt,
    gmail_thread_id: gmailResult.threadId || draft.gmail_thread_id || null,
    gmail_message_id: gmailResult.id || null,
    next_action: 'Awaiting reply',
    next_action_at: null,
  }).eq('id', result.data.id);
  if (update.error) throw update.error;
}

async function updateRelationshipContactAfterSend(db, draft, sentAt) {
  if (!draft.contact_id) return;
  if (!['networking','client','program','grant','general'].includes(draft.draft_type)) return;
  const { links } = await founderSettings(db);
  const containsBooking = Boolean(links.booking_url) && String(draft.body || '').includes(links.booking_url);
  const nextAction = containsBooking ? `Awaiting ${links.booking_label || 'meeting'} booking` : 'Awaiting reply';
  const update = await db.from('crm_contacts').update({
    next_action: nextAction,
    next_action_at: null,
    contact_status: 'new',
    updated_at: sentAt,
  }).eq('id', draft.contact_id);
  if (update.error) throw update.error;
}

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET','POST','PATCH'])) return;
  try {
    if (req.method === 'GET') {
      if (req.query.id) return sendData(res, await getRow('crm_email_drafts', req.query.id));
      if (req.query.email_desk === '1') return sendData(res, await loadEmailDeskRows(getSupabase()));
      return sendData(res, await listRows('crm_email_drafts', req.query, { order: 'updated_at', filters: [['status', req.query.status], ['contact_id', req.query.contact_id]] }));
    }
    const input = bodyOf(req);
    if (req.method === 'POST' && req.query.action) {
      const id = req.query.id || input.id;
      const draft = await getRow('crm_email_drafts', id);
      if (req.query.action === 'approve') {
        assertFounderEmailStyle({ subject: draft.subject, body: draft.body });
        return sendData(res, await updateRow('crm_email_drafts', id, { status: 'approved', needs_human: false }));
      }
      if (req.query.action === 'defer') return sendData(res, await updateRow('crm_email_drafts', id, { status: 'needs_update', scheduled_for: timestampValue(input.scheduled_for, 'scheduled_for') }));
      if (req.query.action === 'cancel') return sendData(res, await updateRow('crm_email_drafts', id, { status: 'cancelled' }));
      if (req.query.action === 'send') {
        if (draft.needs_human || !['approved', 'ready_to_send'].includes(draft.status)) throw Object.assign(new Error('Draft must be explicitly approved before sending'), { code: 'VALIDATION_ERROR' });
        assertFounderEmailStyle({ subject: draft.subject, body: draft.body });
        const db = getSupabase();
        const suppression = await blockedBySuppression(db, draft.to_email);
        if (suppression) throw Object.assign(new Error('This recipient is on the do-not-contact list'), { code: 'VALIDATION_ERROR' });
        const attachments = draftAttachments(draft);
        const result = await sendGmailMessage({
          to: draft.to_email,
          cc: draft.cc_email,
          subject: draft.subject,
          body: draft.body,
          attachments,
          threadId: draft.gmail_thread_id || null,
          replyMessageId: draft.gmail_message_id || null,
        });
        const sentAt = new Date().toISOString();
        const updated = await updateRow('crm_email_drafts', id, { status: 'sent', sent_at: sentAt, gmail_message_id: result.id, gmail_thread_id: result.threadId || draft.gmail_thread_id || null, needs_human: false });
        try { await insertRow('crm_activities', { opportunity_id: draft.opportunity_id, account_id: draft.account_id, contact_id: draft.contact_id, activity_type: 'email_sent', subject: draft.subject, description: draft.body, external_id: `gmail:${result.id || `draft-${id}`}`, metadata: { gmail_message_id: result.id || null, gmail_thread_id: result.threadId || draft.gmail_thread_id || null, direction: 'outbound', source: 'gmail', draft_type: draft.draft_type, artifact_type: draft?.audience_definition?.artifact_type || null, attachment_names: attachments.map((row) => row.name) } }); } catch (_) { /* draft status remains authoritative */ }
        try { await updateOpportunityAfterSend(db, draft, result, sentAt); } catch (_) { /* sent mail remains authoritative; CRM can be reconciled */ }
        try { await updateRelationshipContactAfterSend(db, draft, sentAt); } catch (_) { /* sent mail remains authoritative; relationship state can be reconciled */ }
        return sendData(res, updated);
      }
      throw Object.assign(new Error('Unknown draft action'), { code: 'VALIDATION_ERROR' });
    }
    if (req.method === 'POST') {
      const values = pickDefined(input, editable);
      values.draft_type = values.draft_type || 'general';
      values.status = values.status || 'draft';
      return sendData(res, await insertRow('crm_email_drafts', values), 201);
    }
    return sendData(res, await updateRow('crm_email_drafts', req.query.id, pickDefined(input, editable)));
  } catch (error) { return sendError(res, error); }
}

export default withCommandAuth(handler);
