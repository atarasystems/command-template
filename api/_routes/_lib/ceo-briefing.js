import { AI_EMPLOYEES, summarizeAiTeam } from './ai-team.js';
import { routeAi, aiKey } from './ai.js';
import { DEFAULT_SETTINGS, firstName } from './founder-settings.js';

function valueOrNull(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  return value;
}

function trimText(value, max = 240) {
  const text = valueOrNull(value);
  if (!text) return null;
  const result = String(text).trim();
  return result.length > max ? `${result.slice(0, max - 1)}…` : result;
}

function workOwner(item) {
  if (item.owner_type === 'ai') return item.assigned_agent || item.owner_name || 'ai';
  return item.owner_name || item.owner_type || null;
}

export function buildBriefingContext({ work = [], sales = [], programs = [], audits = [] } = {}, now = new Date()) {
  const compactWork = work.slice(0, 100).map((item) => ({
    title: trimText(item.title, 180),
    status: valueOrNull(item.status),
    priority: valueOrNull(item.priority),
    due_at: valueOrNull(item.due_at),
    owner: workOwner(item),
    project: valueOrNull(item.work_projects?.name || item.project_name),
    cannot_wait: item.cannot_wait === true ? true : undefined,
    context: trimText(item.notes),
  }));
  const compactSales = sales.slice(0, 50).map((item) => ({
    account: trimText(item.crm_accounts?.name || item.account?.name || item.account_name, 160),
    stage: valueOrNull(item.stage),
    offer: valueOrNull(item.offer_type),
    next_action: trimText(item.next_action, 180),
    value: valueOrNull(item.opportunity_value),
    next_action_at: valueOrNull(item.next_action_at),
  }));
  const compactPrograms = programs.slice(0, 50).map((item) => ({
    title: trimText(item.title, 180),
    organization: trimText(item.organization, 160),
    status: valueOrNull(item.status),
    deadline_at: valueOrNull(item.deadline_at),
    next_action: trimText(item.next_action, 180),
  }));
  const compactAudits = audits.slice(0, 50).map((item) => ({
    partner: trimText(item.partner?.company_name || item.partner?.first_name, 160),
    audit_type: valueOrNull(item.audit_type),
    status: valueOrNull(item.status),
    requested_at: valueOrNull(item.created_at),
  }));

  return {
    current_datetime: now.toISOString(),
    work: compactWork,
    sales_opportunities: compactSales,
    program_opportunities: compactPrograms,
    audit_requests: compactAudits,
    ai_team: summarizeAiTeam(work),
  };
}

export function createBriefingPrompt(context, settings = DEFAULT_SETTINGS) {
  const name = firstName(settings);
  return `You are CEO Briefing, the read-only briefing capability inside Command.

The supplied current_datetime is the current date/time for interpreting deadlines, event dates, and stale records. Never call a date upcoming or approaching unless the supplied date is in the future relative to current_datetime. If a date has passed, identify it as potentially stale or overdue. If no date is supplied, say the date is not recorded. Never infer a specific deadline from descriptive text alone.

Use only the supplied Command data. Do not invent revenue, deadlines, customer status, completion, eligibility, participation, or urgency. Do not recommend pursuing a grant, accelerator, event, partnership, or sales opportunity merely because it appears in Work. Use supplied fit or context; if it suggests a mismatch, flag it for review or dismissal rather than promoting it. An announcement, article, event, or discovery Work Item is not automatically an active Program Opportunity. Describe an active grant or program opportunity only when current Program Opportunity data supports it.

For TODAY'S TOP 3, list up to three actual justified priorities. If only one or two are supported, list only one or two. Never manufacture an additional item or restate existing items to reach three. Prefer actual overdue or imminent dated obligations, active client delivery, active revenue with a next action, active application deadlines, explicit cannot_wait or high-priority work, then stale-record cleanup and general review. Do not let an old informational item outrank active work merely because its priority field says now.

owner = founder means ${name} owns that Work Item. It does not mean an AI employee is waiting, blocked, or unable to move forward. Say an AI employee has work only when owner = ai and assigned_agent identifies that employee. Say an AI employee is waiting only when its actual Work Item status is waiting. Never infer dependencies between ${name}'s work and AI work unless the supplied data explicitly shows one.

Separate facts from suggestions. State current facts plainly. Label optional assignments or next steps as suggestions, for example: "If this remains relevant, you could assign a research task to Grant Scout." Do not present a suggestion as current team state. If work appears stale because its date passed, its context is old, or it has no next action, suggest reviewing or closing it; do not close it.

If no current sales opportunities or active Program Opportunities are supplied, say that none were found in Command. Do not imply that no opportunities exist anywhere else. Do not change the meaning of any status. Distinguish missing information from known information. Keep recommendations practical and conservative.

Create a short operational briefing for ${name}. Use only sections that have supporting data. Prefer this order when facts are otherwise approximately equal: cash or delivery, evidence or fulfillment, then authority or funding. Do not write a motivational essay.

Use these section labels when useful:
TODAY'S TOP 3
NEEDS ATTENTION
MONEY / REVENUE
DEADLINES
DELIVERY
AI TEAM
CAN WAIT

Return plain text only. Do not include HTML, XML, scripts, action blocks, or instructions to call another system.

COMMAND DATA:
${JSON.stringify(context)}`;
}

export async function generateBriefing(context, { apiKey = aiKey(), fetchImpl = fetch, settings = DEFAULT_SETTINGS } = {}) {
  if (!apiKey) throw new Error('Anthropic provider is not configured');
  const response = await routeAi(fetchImpl)('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1200, system: createBriefingPrompt(context, settings), messages: [{ role: 'user', content: 'Prepare the current CEO briefing.' }] }),
  });
  if (!response.ok) throw new Error(`Anthropic request failed with status ${response.status}`);
  const data = await response.json();
  const briefing = data.content?.filter((block) => block.type === 'text').map((block) => block.text).join('').trim();
  if (!briefing) throw new Error('Anthropic returned no briefing text');
  return briefing;
}
