// Provisional ranking inputs for Funding options, so Options can sort by money and by likelihood.
// These only fill empty scores. Anything the founder sets always wins.

const FIT = { very_high: 90, high: 75, medium: 55, investigate: 35 };
const LIKELY = { 1: 20, 2: 40, 3: 60, 4: 80, 5: 95 };
const FEDERAL = /(sbir|sttr|\bnih\b|\bnsf\b|national science foundation|national institutes|nidilrr|arpa-h|grants\.gov|department of|administration for community living)/i;

export function moneyScore(max) {
  const n = Number(max);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 10000) return 20;
  if (n < 25000) return 40;
  if (n < 100000) return 60;
  if (n < 300000) return 80;
  return 100;
}

// Days to start before the deadline, when a program does not say.
export function defaultLeadDays(p = {}) {
  if (FEDERAL.test(`${p.title || p.program_name || ''} ${p.organization || ''}`)) return 45;
  if (['accelerator', 'pitch_competition', 'fellowship', 'program'].includes(p.opportunity_type)) return 14;
  if (['grant', 'funding', 'procurement'].includes(p.opportunity_type)) return 21;
  return 7;
}

function dayKey(value) { return value ? String(value).slice(0, 10) : null; }
function addDays(key, days) { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }

export function prepStartFor(p = {}) {
  const deadline = dayKey(p.deadline_at || p.deadline);
  if (!deadline) return null;
  return addDays(deadline, -(Number(p.lead_time_days) || defaultLeadDays(p)));
}

export function eligibilityScore(p = {}) {
  const text = `${p.eligibility || ''} ${p.notes || ''} ${p.fit_rationale || ''}`.toLowerCase();
  if (/(must be within|depends on|partner required|requires a partner|unless|confirm|verify|unverified)/.test(text)) return 50;
  if (p.fit_label === 'investigate') return 50;
  if (p.fit_label === 'very_high' || p.fit_label === 'high') return 85;
  return 50;
}

export function dilutionScore(p = {}) {
  if (p.is_non_dilutive === true || ['grant', 'prize', 'credits'].includes(p.funding_structure)) return 100;
  if (/note|safe/i.test(p.equity_terms_text || '')) return 60;
  if (p.funding_structure === 'investment' || p.is_non_dilutive === false) return 30;
  return null;
}

export function deadlineTimingScore(p = {}, today = new Date().toISOString().slice(0, 10)) {
  const start = p.prep_start_at || prepStartFor(p);
  const deadline = dayKey(p.deadline_at || p.deadline);
  if (!deadline) return 70; // Rolling: no rush, no penalty.
  if (deadline < today) return 0;
  if (!start) return 70;
  return start >= addDays(today, 7) ? 100 : 50;
}

// Scores to fill in. Only keys whose current value is empty come back.
export function provisionalScores(p = {}, { likelihood, today } = {}) {
  const want = {
    funding_value_score: moneyScore(p.funding_max_amount ?? p.amount_value),
    strategic_fit_score: FIT[p.fit_label] ?? null,
    eligibility_confidence_score: p.fit_label ? eligibilityScore(p) : null,
    realism_score: likelihood ? LIKELY[Math.round(likelihood)] ?? null : null,
    deadline_timing_score: deadlineTimingScore(p, today),
    dilution_cost_score: dilutionScore(p),
  };
  const out = {};
  for (const [key, value] of Object.entries(want)) {
    if (value === null || value === undefined) continue;
    if (p[key] === null || p[key] === undefined || p[key] === '') out[key] = value;
  }
  return out;
}

// Group shown on each option card: money and likelihood.
export function fundingGroup(p = {}) {
  const money = Number(p.funding_value_score) >= 60;
  const likely = Number(p.realism_score) >= 50;
  if (money && likely) return 'Do first';
  if (money) return 'Big long shot';
  if (likely) return 'Quick win';
  return 'Low priority';
}
export const GROUP_ORDER = ['Do first', 'Quick win', 'Big long shot', 'Low priority'];
