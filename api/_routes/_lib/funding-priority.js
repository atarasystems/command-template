export const PRIORITY_WEIGHTS = Object.freeze({
  strategic_fit_score: 25,
  eligibility_confidence_score: 20,
  funding_value_score: 15,
  realism_score: 15,
  readiness_score: 10,
  deadline_timing_score: 5,
  effort_efficiency_score: 5,
  dilution_cost_score: 5,
});

const LABELS = Object.freeze({
  strategic_fit_score: 'Strategic fit',
  eligibility_confidence_score: 'Eligibility confidence',
  funding_value_score: 'Funding/program value',
  realism_score: 'Probability/realism',
  readiness_score: 'Readiness/reusability',
  deadline_timing_score: 'Deadline timing',
  effort_efficiency_score: 'Effort efficiency',
  dilution_cost_score: 'Dilution/equity cost',
});

function knownScore(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
}

export function calculateFundingPriority(opportunity) {
  let weighted = 0;
  let knownWeight = 0;
  const known = [];
  const missing = [];
  for (const [field, weight] of Object.entries(PRIORITY_WEIGHTS)) {
    const score = knownScore(opportunity?.[field]);
    if (score === null) missing.push(LABELS[field]);
    else {
      weighted += score * weight;
      knownWeight += weight;
      known.push({ field, label: LABELS[field], score, weight });
    }
  }
  const completeness = knownWeight / 100;
  const score = knownWeight ? Math.round(weighted / knownWeight) : null;
  const confidence = completeness >= 0.8 ? 'high' : completeness >= 0.5 ? 'medium' : 'low';
  const label = score === null ? 'Needs Review' : score >= 75 ? 'High Priority' : score >= 50 ? 'Medium Priority' : 'Needs Review';
  return { score, label, completeness, completeness_percent: Math.round(completeness * 100), confidence, known, missing, provisional: completeness < 1 };
}

export function priorityRationale(opportunity) {
  const parts = [];
  if (opportunity?.fit_notes) parts.push('fit notes recorded');
  if (opportunity?.eligibility) parts.push('eligibility notes recorded');
  if (opportunity?.amount_text || opportunity?.amount_value !== null && opportunity?.amount_value !== undefined) parts.push(`${opportunity.amount_text || `$${opportunity.amount_value}`} potential`);
  if (opportunity?.effort_min_hours !== null && opportunity?.effort_min_hours !== undefined) parts.push(`estimated ${opportunity.effort_min_hours}${opportunity.effort_max_hours ? ` to ${opportunity.effort_max_hours}` : ''} hours`);
  return parts;
}

export function fundingPriorityFields(input = {}) {
  const fields = Object.keys(PRIORITY_WEIGHTS).concat(['effort_min_hours', 'effort_max_hours']);
  return Object.fromEntries(fields.filter((field) => Object.prototype.hasOwnProperty.call(input, field)).map((field) => [field, input[field]]));
}
