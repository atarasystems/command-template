import { getSupabase } from './supabase.js';

export const WATCH_FIT_LABELS = new Set(['very_high', 'high', 'medium', 'investigate']);
export const WATCH_STRUCTURES = new Set(['grant', 'reimbursement', 'investment', 'credits', 'prize', 'other']);
export const WATCH_EFFORT_LEVELS = new Set(['very_light', 'light', 'moderate', 'substantial', 'major']);

const MAX_TEXT = 10000;
const REQUIREMENT_HOURS = Object.freeze({ narrative_questions: 2, technical_narrative: 6, research_plan: 8, research_strategy: 8, budget: 2, budget_justification: 2, commercialization_plan: 3, financials: 2, registrations: 1, attachments: 2, letters_of_support: 3, partner_coordination: 4, pitch_deck: 1, video: 1, interview: 2, project_pitch: 3 });
const UPDATE_FIELDS = [
  'opportunity_type', 'organization', 'source_url', 'source_type', 'source_id', 'external_program_id',
  'amount_value', 'amount_text', 'funding_min_amount', 'funding_max_amount', 'funding_value_text',
  'funding_structure', 'is_non_dilutive', 'equity_percent', 'equity_terms_text', 'eligibility',
  'fit_notes', 'fit_label', 'fit_rationale', 'priority_label', 'priority_rank', 'deadline_at',
  'effort_min_hours', 'effort_max_hours', 'effort_level', 'effort_rationale', 'reuse_level',
  'application_requirements_json', 'required_partners', 'source_verified_at',
];

function text(value, field) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > MAX_TEXT) throw Object.assign(new Error(`${field} is invalid`), { code: 'VALIDATION_ERROR' });
  return value.trim();
}

export function normalizeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    url.hash = '';
    [...url.searchParams.keys()].filter((key) => /^(utm_|fbclid$|gclid$)/i.test(key)).forEach((key) => url.searchParams.delete(key));
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/$/, '');
  } catch { throw Object.assign(new Error('official_url must be a valid http or https URL'), { code: 'VALIDATION_ERROR' }); }
}

export function normalizeIdentity(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function estimateApplicationEffort(requirements = {}, reuseLevel = null) {
  const raw = Object.entries(requirements).reduce((total, [key, value]) => total + (value ? (REQUIREMENT_HOURS[key] || 0) : 0), 0);
  if (!raw) return null;
  const reuseReduction = reuseLevel === 'high' ? 3 : reuseLevel === 'medium' ? 1 : 0;
  const min = Math.max(0.5, raw - reuseReduction);
  const max = Math.max(min, Math.ceil(min * (raw >= 15 ? 1.6 : 1.5)));
  const effort_level = max >= 20 ? 'major' : max >= 8 ? 'substantial' : max >= 4 ? 'moderate' : max >= 2 ? 'light' : 'very_light';
  return { effort_min_hours: min, effort_max_hours: max, effort_level };
}

export function normalizeWatchPayload(payload = {}) {
  const title = text(payload.program_name || payload.title, 'program_name');
  const organization = text(payload.organization, 'organization');
  if (!title) throw Object.assign(new Error('program_name is required'), { code: 'VALIDATION_ERROR' });
  if (payload.funding_intent === 'chosen') throw Object.assign(new Error('Funding Watch cannot set funding intent to chosen'), { code: 'VALIDATION_ERROR' });
  if (!payload.opportunity_type) throw Object.assign(new Error('opportunity_type is required'), { code: 'VALIDATION_ERROR' });
  if (!['grant', 'accelerator', 'pitch_competition', 'procurement', 'funding', 'fellowship', 'program', 'other'].includes(payload.opportunity_type)) throw Object.assign(new Error('opportunity_type is invalid'), { code: 'VALIDATION_ERROR' });
  if (payload.fit_label === 'low') return { skipped: true, reason: 'low_fit' };
  if (payload.fit_label && !WATCH_FIT_LABELS.has(payload.fit_label)) throw Object.assign(new Error('fit_label must be very_high, high, medium, or investigate'), { code: 'VALIDATION_ERROR' });
  if (payload.funding_structure && !WATCH_STRUCTURES.has(payload.funding_structure)) throw Object.assign(new Error('funding_structure is invalid'), { code: 'VALIDATION_ERROR' });
  if (payload.effort_level && !WATCH_EFFORT_LEVELS.has(payload.effort_level)) throw Object.assign(new Error('effort_level is invalid'), { code: 'VALIDATION_ERROR' });
  const officialUrl = normalizeUrl(payload.official_url || payload.source_url);
  const requirements = payload.application_requirements || null;
  const effort = requirements && (!payload.effort_min_hours || !payload.effort_max_hours) ? estimateApplicationEffort(requirements, payload.reuse_level) : null;
  const result = {
    opportunity_type: payload.opportunity_type, title, organization, source_url: officialUrl,
    source_type: payload.source_type || 'funding_watch', source_id: text(payload.source_id, 'source_id'),
    external_program_id: text(payload.external_program_id, 'external_program_id'), amount_value: payload.amount_value,
    amount_text: text(payload.amount_text || payload.funding_value, 'funding_value'), funding_min_amount: payload.funding_min_amount,
    funding_max_amount: payload.funding_max_amount, funding_value_text: text(payload.funding_value_text, 'funding_value_text'),
    funding_structure: payload.funding_structure, is_non_dilutive: payload.is_non_dilutive, equity_percent: payload.equity_percent,
    equity_terms_text: text(payload.equity_terms_text || payload.equity_terms, 'equity_terms'), eligibility: text(payload.eligibility, 'eligibility'),
    fit_notes: text(payload.fit_notes, 'fit_notes'), fit_label: payload.fit_label, fit_rationale: text(payload.fit_rationale, 'fit_rationale'),
    priority_label: text(payload.priority_label || payload.recommendation, 'recommendation'), priority_rank: payload.priority_rank, dilution_cost_score: payload.dilution_cost_score,
    deadline_at: payload.deadline || payload.deadline_at || null, effort_min_hours: payload.effort_min_hours ?? effort?.effort_min_hours,
    effort_max_hours: payload.effort_max_hours ?? effort?.effort_max_hours, effort_level: payload.effort_level || effort?.effort_level, effort_rationale: text(payload.effort_rationale, 'effort_rationale'),
    reuse_level: text(payload.reuse_level, 'reuse_level'), application_requirements_json: payload.application_requirements || null,
    required_partners: text(payload.required_partners, 'required_partners'), source_verified_at: payload.source_verified_at || null,
    notes: text(payload.notes, 'notes'),
    status: 'discovered', funding_intent: 'option',
  };
  for (const key of ['amount_value', 'funding_min_amount', 'funding_max_amount', 'equity_percent', 'priority_rank', 'effort_min_hours', 'effort_max_hours']) {
    if (result[key] !== undefined && result[key] !== null && (!Number.isFinite(Number(result[key])) || Number(result[key]) < 0)) throw Object.assign(new Error(`${key} must be a non-negative number`), { code: 'VALIDATION_ERROR' });
  }
  if (result.application_requirements_json !== null && (typeof result.application_requirements_json !== 'object' || Array.isArray(result.application_requirements_json))) throw Object.assign(new Error('application_requirements must be an object'), { code: 'VALIDATION_ERROR' });
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
}

export function findOpportunityMatch(records, input) {
  const url = normalizeUrl(input.source_url);
  const externalId = input.external_program_id;
  const title = normalizeIdentity(input.title);
  const organization = normalizeIdentity(input.organization);
  return (records || []).find((record) => (url && normalizeUrl(record.source_url) === url)
    || (externalId && record.external_program_id === externalId)
    || (title && organization && normalizeIdentity(record.title) === title && normalizeIdentity(record.organization) === organization)) || null;
}

export function mergeWatchOpportunity(existing, input) {
  const merged = Object.fromEntries(Object.entries(input).filter(([key, value]) => !['funding_intent', 'status', 'title', 'notes'].includes(key) && value !== null && value !== undefined));
  // Watch data never overwrites explicit scoring inputs, intent, notes, or lifecycle state.
  return { ...merged, ...(existing?.updated_at ? { updated_at: new Date().toISOString() } : {}) };
}

export async function ingestFundingWatch(payload, db = getSupabase()) {
  const input = normalizeWatchPayload(payload);
  if (input.skipped) return input;
  const records = await db.from('crm_program_opportunities').select('*').limit(500);
  if (records.error) throw records.error;
  const existing = findOpportunityMatch(records.data || [], input);
  if (!existing) {
    const created = await db.from('crm_program_opportunities').insert(input).select().single();
    if (created.error) throw created.error;
    return { status: 'created', opportunity: created.data };
  }
  const changes = mergeWatchOpportunity(existing, input);
  const updated = await db.from('crm_program_opportunities').update(changes).eq('id', existing.id).select().single();
  if (updated.error) throw updated.error;
  return { status: 'updated', opportunity: updated.data, preserved: { funding_intent: existing.funding_intent, status: existing.status, id: existing.id } };
}

export const watchUpdateFields = UPDATE_FIELDS;
