export const RESPONSE_TYPES = Object.freeze(['submitted', 'acknowledged', 'more_info_requested', 'interview', 'finalist', 'decision_pending', 'awarded', 'not_selected', 'withdrawn', 'portal_update', 'meeting', 'phone_call', 'manual_update']);
export const RESPONSE_STATUSES = Object.freeze(['Submitted', 'Acknowledged', 'More Info Requested', 'Interview / Pitch', 'Finalist', 'Decision Pending', 'Awarded', 'Not Selected', 'Withdrawn']);

const statusByType = { acknowledged: 'Acknowledged', more_info_requested: 'More Info Requested', interview: 'Interview / Pitch', finalist: 'Finalist', decision_pending: 'Decision Pending', awarded: 'Awarded', not_selected: 'Not Selected', withdrawn: 'Withdrawn' };

export function normalizeResponse(input = {}) {
  if (!input.application_id) throw Object.assign(new Error('application_id is required'), { code: 'VALIDATION_ERROR' });
  if (!input.response_date || Number.isNaN(new Date(input.response_date).getTime())) throw Object.assign(new Error('A valid response date is required'), { code: 'VALIDATION_ERROR' });
  if (!RESPONSE_TYPES.includes(input.response_type)) throw Object.assign(new Error('Choose a valid update type'), { code: 'VALIDATION_ERROR' });
  if (!String(input.summary || '').trim()) throw Object.assign(new Error('A response summary is required'), { code: 'VALIDATION_ERROR' });
  if (input.action_due_at && Number.isNaN(new Date(input.action_due_at).getTime())) throw Object.assign(new Error('action_due_at must be a valid date'), { code: 'VALIDATION_ERROR' });
  return {
    application_id: input.application_id, response_date: new Date(input.response_date).toISOString(), response_type: input.response_type,
    summary: String(input.summary).trim().slice(0, 5000), source_type: input.source_type || 'manual', source_reference: input.source_reference || null,
    gmail_message_id: input.gmail_message_id || null, gmail_thread_id: input.gmail_thread_id || null, action_required: Boolean(input.action_required),
    next_action: input.next_action ? String(input.next_action).trim().slice(0, 1000) : null, action_due_at: input.action_due_at ? new Date(input.action_due_at).toISOString() : null,
    notes: input.notes ? String(input.notes).trim().slice(0, 5000) : null,
    award_amount: input.award_amount === undefined || input.award_amount === null || input.award_amount === '' ? null : Number(input.award_amount),
    award_date: input.award_date || null, program_start_at: input.program_start_at || null, program_end_at: input.program_end_at || null,
    award_conditions: input.award_conditions ? String(input.award_conditions).trim().slice(0, 5000) : null, agreement_url: input.agreement_url || null,
  };
}

export function responseStatusForType(type, current = null) { return statusByType[type] || current || 'Submitted'; }

export function applicationSummaryFromResponse(response, current = {}) {
  const isLatest = !current.latest_response_at || new Date(response.response_date) >= new Date(current.latest_response_at);
  const next = isLatest ? { latest_response_at: response.response_date, latest_response_summary: response.summary } : {};
  if (!isLatest) return next;
  if (response.next_action) next.next_action = response.next_action;
  if (response.action_due_at) next.next_action_due_at = response.action_due_at;
  const responseStatus = responseStatusForType(response.response_type, current.response_status);
  next.response_status = responseStatus;
  if (response.response_type === 'awarded') { next.final_outcome = 'awarded'; next.status = 'awarded'; }
  if (response.response_type === 'not_selected') { next.final_outcome = 'not_selected'; next.status = 'not_selected'; }
  if (response.response_type === 'withdrawn') { next.final_outcome = 'withdrawn'; next.status = 'archived'; }
  if (response.response_type === 'interview' || response.response_type === 'finalist') next.status = 'interview';
  if (['acknowledged', 'more_info_requested', 'decision_pending'].includes(response.response_type)) next.status = 'awaiting_response';
  if (response.award_amount !== null) next.award_amount = response.award_amount;
  if (response.award_date) next.award_date = response.award_date;
  if (response.program_start_at) next.program_start_at = response.program_start_at;
  if (response.program_end_at) next.program_end_at = response.program_end_at;
  if (response.award_conditions) next.award_conditions = response.award_conditions;
  if (response.agreement_url) next.agreement_url = response.agreement_url;
  return next;
}

export function isResponseAttentionItem(application, now = new Date()) {
  if (application.next_action_due_at && new Date(application.next_action_due_at) <= now && application.next_action) return true;
  return Boolean(application.next_action && application.response_status === 'More Info Requested');
}
