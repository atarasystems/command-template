const COMMERCIAL_STAGE_GROUPS = {
  review: new Set(['new', 'researching', 'ready_for_review']),
  pursue: new Set(['approved_to_send', 'contacted', 'replied', 'interested', 'follow_up', 'upsell']),
  won: new Set(['payment_sent', 'paid', 'audit_in_progress', 'delivered']),
  passed: new Set(['not_now', 'lost', 'do_not_contact']),
};

const PROGRAM_STAGE_GROUPS = {
  review: new Set(['discovered', 'reviewing']),
  pursue: new Set(['apply', 'in_progress', 'submitted', 'interview', 'final_decision']),
  waiting: new Set(['awaiting_response']),
  won: new Set(['awarded']),
  passed: new Set(['not_selected', 'archived']),
};

export const HUB_TYPE_LABELS = {
  seo_geo: 'SEO/GEO Prospect',
  free_training: 'Free Training',
  paid_training: 'Paid Training',
  consulting: 'Consulting',
  partner_referral: 'Partner / Referral',
  subcontracting: 'Subcontracting',
  grant_program: 'Grant / Program',
  sponsorship_licensing: 'Sponsorship / Licensing',
  other_strategic: 'Other Strategic',
};

function displayName(contact) {
  if (!contact) return null;
  return contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(' ') || contact.email || null;
}

function stageGroup(value, groups) {
  for (const [group, values] of Object.entries(groups)) if (values.has(value)) return group;
  return 'other';
}

function commercialType(row) {
  if (row.offer_type === 'seo_geo_audit') return 'seo_geo';
  if (row.offer_type === 'referral_partnership' || row.pipeline === 'partner' || row.pipeline === 'referral') return 'partner_referral';
  if (row.pipeline === 'institutional') return 'other_strategic';
  return 'other_strategic';
}

function programType(row) {
  return 'grant_program';
}

function dateValue(value) {
  return value ? new Date(value) : null;
}

function dueSoonOrOverdue(value, now, days = 3) {
  const date = dateValue(value);
  if (!date || Number.isNaN(date.getTime())) return false;
  const limit = new Date(now.getTime() + days * 86400000);
  return date <= limit;
}

export function normalizeCommercialOpportunity(row, work = null, now = new Date()) {
  const account = row.account || null;
  const contact = row.contact || null;
  const stage = row.stage || 'new';
  const stageGroupValue = stageGroup(stage, COMMERCIAL_STAGE_GROUPS);
  const needsAttention = Boolean(row.needs_human)
    || dueSoonOrOverdue(row.next_action_at, now)
    || COMMERCIAL_STAGE_GROUPS.review.has(stage)
    || Boolean(work && dueSoonOrOverdue(work.due_at, now));
  return {
    source_table: 'crm_opportunities',
    source_kind: 'commercial',
    id: row.id,
    title: account?.name || row.offer_type || 'Commercial opportunity',
    organization: account?.name || null,
    person: displayName(contact),
    person_email: contact?.email || null,
    type: commercialType(row),
    type_label: HUB_TYPE_LABELS[commercialType(row)],
    source_label: row.lead_source || 'Unknown source',
    source_url: row.evidence_url || row.contact_form_url || null,
    why_it_matters: row.problem_spotted || row.personalization_angle || row.research_notes || null,
    value: row.opportunity_value,
    tier: row.qualification_grade || null,
    stage: stageGroupValue,
    stage_label: { review: 'New / Review', pursue: 'Pursue', won: 'Won / Delivered', passed: 'Lost / Passed' }[stageGroupValue] || 'Other',
    underlying_status: stage,
    next_action: row.next_action || null,
    next_action_at: row.next_action_at || null,
    deadline: null,
    owner: work?.owner_name || null,
    needs_attention: needsAttention,
    needs_human: Boolean(row.needs_human),
    evidence: row.evidence || null,
    notes: row.research_notes || null,
    personalization_angle: row.personalization_angle || null,
    qualification: row.qualification_grade || null,
    activity_context: null,
    work: work ? { id: work.id, title: work.title, status: work.status, due_at: work.due_at, owner: work.owner_name || null } : null,
  };
}

export function normalizeProgramOpportunity(row, work = null, now = new Date()) {
  const account = row.crm_accounts || row.account || null;
  const contact = row.crm_contacts || row.contact || null;
  const status = row.status || 'discovered';
  const group = stageGroup(status, PROGRAM_STAGE_GROUPS);
  const needsAttention = ['discovered', 'reviewing', 'apply', 'in_progress', 'submitted', 'awaiting_response'].includes(status)
    && (dueSoonOrOverdue(row.deadline_at, now, 30) || dueSoonOrOverdue(row.follow_up_at, now) || !row.deadline_at)
    || Boolean(work && dueSoonOrOverdue(work.due_at, now));
  return {
    source_table: 'crm_program_opportunities',
    source_kind: 'program',
    id: row.id,
    title: row.title,
    organization: row.organization || account?.name || null,
    person: displayName(contact),
    person_email: contact?.email || null,
    type: programType(row),
    type_label: HUB_TYPE_LABELS[programType(row)],
    source_label: row.source_type || 'Program source',
    source_url: row.source_url || null,
    why_it_matters: row.fit_notes || row.eligibility || row.notes || null,
    value: row.amount_value ?? row.amount_text ?? null,
    tier: null,
    stage: group,
    stage_label: { review: 'New / Review', pursue: 'Pursue', waiting: 'Waiting', won: 'Won / Delivered', passed: 'Lost / Passed' }[group] || 'Other',
    underlying_status: status,
    next_action: row.follow_up_at ? 'Follow up on program opportunity' : null,
    next_action_at: row.follow_up_at || null,
    deadline: row.deadline_at || null,
    owner: work?.owner_name || null,
    needs_attention: needsAttention,
    needs_human: false,
    evidence: row.source_url || null,
    notes: row.notes || null,
    personalization_angle: null,
    qualification: null,
    activity_context: null,
    work: work ? { id: work.id, title: work.title, status: work.status, due_at: work.due_at, owner: work.owner_name || null } : null,
  };
}

export function normalizeOpportunityHub({ commercial = [], programs = [], workItems = [], now = new Date() } = {}) {
  const workBySource = new Map((workItems || []).map((item) => [`${item.source_type}:${item.source_id}`, item]));
  const rows = [
    ...(commercial || []).map((row) => normalizeCommercialOpportunity(row, workBySource.get(`crm_opportunity:${row.id}`) || workBySource.get(`opportunity:${row.id}`), now)),
    ...(programs || []).map((row) => normalizeProgramOpportunity(row, workBySource.get(`program_opportunity:${row.id}`), now)),
  ];
  return rows.sort((a, b) => Number(b.needs_attention) - Number(a.needs_attention) || (a.next_action_at || a.deadline || '9999').localeCompare(b.next_action_at || b.deadline || '9999'));
}
