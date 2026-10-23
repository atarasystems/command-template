import { assertFounderEmailStyle, normalizeNoLongDashes } from './email-style.js';
import { routeAi, aiKey } from './ai.js';
import { DEFAULT_SETTINGS, firstName, companyName, knowledgeText } from './founder-settings.js';

function valueOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return value;
}

function trimText(value, max = 280) {
  const text = valueOrNull(value);
  if (!text) return null;
  const result = String(text).trim();
  return result.length > max ? `${result.slice(0, max - 1)}…` : result;
}

function personName(contact) {
  return contact?.full_name || [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || null;
}

export function buildOutreachContext(opportunity, activities = []) {
  const account = opportunity.account || opportunity.crm_accounts || {};
  const contact = opportunity.contact || opportunity.crm_contacts || {};
  return {
    account: trimText(account.name || opportunity.account_name, 180),
    website: trimText(opportunity.website, 240),
    contact: trimText(personName(contact), 160),
    contact_role: trimText(contact.job_title, 160),
    stage: valueOrNull(opportunity.stage),
    offer: valueOrNull(opportunity.offer_type),
    opportunity_value: valueOrNull(opportunity.opportunity_value),
    next_action: trimText(opportunity.next_action, 220),
    next_action_at: valueOrNull(opportunity.next_action_at),
    lead_source: valueOrNull(opportunity.lead_source),
    trigger_type: valueOrNull(opportunity.trigger_type),
    qualification_grade: valueOrNull(opportunity.qualification_grade),
    problem_spotted: trimText(opportunity.problem_spotted),
    research_notes: trimText(opportunity.research_notes),
    personalization_angle: trimText(opportunity.personalization_angle),
    evidence: trimText(opportunity.evidence),
    outreach_path: trimText(opportunity.outreach_path),
    recent_activity: activities.slice(0, 8).map((activity) => ({
      type: valueOrNull(activity.activity_type),
      subject: trimText(activity.subject, 180),
      context: trimText(activity.description),
      occurred_at: valueOrNull(activity.occurred_at),
    })),
  };
}

export function createOutreachPrompt(context, settings = DEFAULT_SETTINGS) {
  const name = firstName(settings);
  return `You are Business Development, the read-only outreach-preparation capability inside Command.

Prepare outreach for exactly the supplied Revenue CRM prospect. Use only the supplied facts. Separate KNOWN facts, INFERENCE, and SUGGESTION. The draft email may state only known facts as facts. If no buying signal is recorded, say exactly: "No clear buying signal is recorded in Command." Do not invent a buying signal, problem, ad spend, traffic loss, launch, growth, demographics, pain, budget, urgency, or prior engagement.

Do not treat a website URL alone as evidence of a need. Do not recommend an opportunity merely because it exists in CRM. If the supplied context does not support fit, say that fit is not established and keep the angle tentative.

WHAT THE COMPANY OFFERS (from setup; use only when relevant):
${knowledgeText(settings)}

Never promise or imply guaranteed results, revenue or outcomes.

FOUNDER VOICE RULES FOR draft_email AND follow_up:
- Write like ${name} personally typed the note after looking at this specific prospect.
${settings?.voice?.no_dashes ? '- Never output Unicode U+2013 or U+2014. Use a comma, period, colon, parentheses, or a standard hyphen instead.\n' : ''}- Use plain, natural American English and contractions when they sound normal.
- Cold outreach should usually be 55 to 110 words. Follow-up should usually be 30 to 75 words.
- Start with the actual reason for writing or one grounded detail. Do not start with generic pleasantries or praise.
- Use one specific researched detail when one is supplied. Do not stack generic compliments.
- Keep sentences simple. Slightly imperfect and human is better than polished sales copy.
- Do not over-explain ${companyName(settings)}, pile up benefits, or sound like a marketing automation template.
- Do not use bullet lists inside the email.
- Do not use canned outreach phrases such as "I hope this email finds you well," "I came across," "I wanted to reach out," "I'm reaching out," "touch base," "circle back," "second set of eyes," "low-risk pilot," "would it be useful if," "would you be open to," "just checking in," "quick chat," "quick question," "unlock," "leverage," "seamless," "game changer," or "synergy."
- Do not use fake familiarity, exaggerated praise, urgency, pressure, or marketing jargon.
- Make the ask easy to answer. Prefer something natural such as "Want me to send the details?"

For cold outreach, do not try to close the sale or lead with pricing unless the supplied purpose or prior activity specifically calls for pricing. Do not ask for a meeting by default. Draft on behalf of ${settings?.founder?.signoff || name} at ${companyName(settings)} when a signature is appropriate; never use a placeholder such as [Your Name]. Do not insert a payment link in first-touch cold outreach.

Return valid JSON only with these fields:
{
  "why_this_business": "short factual explanation",
  "best_angle": "supported angle, or state that fit is not established",
  "draft_email": "short plain-text email",
  "follow_up": "one short plain-text follow-up",
  "do_not_claim": ["unsupported claim or assumption to avoid"],
  "optional_next_step": "one short suggestion, clearly a suggestion"
}
Do not include HTML, XML, scripts, action blocks, send instructions, or fields outside this schema. If information is missing, say so briefly instead of filling the gap.

SUPPLIED CRM CONTEXT:
${JSON.stringify(context)}`;
}

function jsonText(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned);
}

export function parseOutreachResponse(text) {
  const parsed = jsonText(text);
  const fields = ['why_this_business', 'best_angle', 'draft_email', 'follow_up', 'optional_next_step'];
  for (const field of fields) if (typeof parsed[field] !== 'string') throw new Error('Outreach response missing required text');
  if (!Array.isArray(parsed.do_not_claim) || parsed.do_not_claim.some((item) => typeof item !== 'string')) throw new Error('Outreach response has invalid safeguards');

  const result = {
    why_this_business: parsed.why_this_business.trim(),
    best_angle: parsed.best_angle.trim(),
    draft_email: normalizeNoLongDashes(parsed.draft_email).trim(),
    follow_up: normalizeNoLongDashes(parsed.follow_up).trim(),
    do_not_claim: parsed.do_not_claim.map((item) => normalizeNoLongDashes(item).trim()).filter(Boolean),
    optional_next_step: parsed.optional_next_step.trim(),
  };
  assertFounderEmailStyle({ body: result.draft_email });
  assertFounderEmailStyle({ body: result.follow_up });
  return result;
}

export async function generateOutreachPrep(context, { apiKey = aiKey(), fetchImpl = fetch, settings = DEFAULT_SETTINGS } = {}) {
  if (!apiKey) throw new Error('Anthropic provider is not configured');
  const response = await routeAi(fetchImpl)('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1300, system: createOutreachPrompt(context, settings), messages: [{ role: 'user', content: 'Prepare the outreach packet.' }] }),
  });
  if (!response.ok) throw new Error(`Anthropic request failed with status ${response.status}`);
  const data = await response.json();
  const text = data.content?.filter((block) => block.type === 'text').map((block) => block.text).join('');
  return parseOutreachResponse(text);
}
