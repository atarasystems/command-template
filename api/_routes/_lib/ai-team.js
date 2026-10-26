export const AI_EMPLOYEES = Object.freeze([
  { key: 'revenue_scout', name: 'Revenue Scout', responsibility: 'Find and rank qualified revenue opportunities.', execution_mode: 'External workflow' },
  { key: 'business_development', name: 'Business Development', responsibility: 'Move qualified prospects and partners toward conversations.', execution_mode: 'Command-assisted' },
  { key: 'grant_scout', name: 'Grant Scout', responsibility: 'Identify and organize funding and program opportunities.', execution_mode: 'Manual handoff' },
  { key: 'follow_up', name: 'Follow-Up Agent', responsibility: 'Surface follow-ups and prepare the next communication.', execution_mode: 'Manual handoff' },
  { key: 'client_success', name: 'Client Success', responsibility: 'Stay ahead of client delivery and relationship needs.', execution_mode: 'Manual handoff' },
  { key: 'ceo_briefing', name: 'CEO Briefing', responsibility: 'Synthesize the most important work across the company.', execution_mode: 'Command-assisted' },
]);

const EMPLOYEE_KEYS = new Set(AI_EMPLOYEES.map((employee) => employee.key));

export function getAiEmployee(key) {
  return AI_EMPLOYEES.find((employee) => employee.key === key) || null;
}

export function validateAiAssignment(input) {
  if (Object.prototype.hasOwnProperty.call(input || {}, 'assigned_agent')) {
    const value = input.assigned_agent;
    if (value !== null && (typeof value !== 'string' || !EMPLOYEE_KEYS.has(value))) return 'assigned_agent must be a supported AI employee';
  }
  if (input?.assigned_agent !== undefined && input.assigned_agent !== null && input.owner_type !== 'ai') return 'assigned_agent requires owner_type ai';
  return null;
}

export function nextActionForWork(item) {
  if (item.status === 'waiting') return 'Waiting for next input';
  if (item.status === 'in_progress') return 'Continue work';
  if (item.status === 'open') return 'Start work';
  if (item.status === 'done') return 'Done';
  return 'Cancelled';
}

export function aiWorkNeedsFounder(item) {
  if (!item || item.owner_type !== 'ai') return false;
  if (item.needs_founder === true || item.needs_human === true) return true;
  return item.status === 'waiting' && /founder|approval|decision|input|review/i.test(String(item.notes || ''));
}

export function handoffPacket(item) {
  const lines = [
    ['Employee', getAiEmployee(item.assigned_agent)?.name],
    ['Task', item.title],
    ['Project', item.project_name || item.work_projects?.name],
    ['Priority', item.priority],
    ['Due', item.due_at],
    ['Context', item.notes],
    ['Relevant source/link', item.source_id ? `${item.source_type || 'source'}: ${item.source_id}` : null],
    ['Expected next action', nextActionForWork(item)],
  ].filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== '');
  return lines.map(([label, value]) => `${label}: ${value}`).join('\n');
}

export function summarizeAiTeam(items) {
  const active = (items || []).filter((item) => !['done', 'cancelled'].includes(item.status));
  const counts = (rows) => ({
    open_count: rows.filter((item) => item.status === 'open').length,
    in_progress_count: rows.filter((item) => item.status === 'in_progress').length,
    waiting_count: rows.filter((item) => item.status === 'waiting').length,
  });
  return {
    assigned_to_ai_count: active.filter((item) => item.owner_type === 'ai').length,
    in_progress_count: active.filter((item) => item.owner_type === 'ai' && item.status === 'in_progress').length,
    waiting_count: active.filter((item) => item.owner_type === 'ai' && item.status === 'waiting').length,
    needs_founder_count: active.filter(aiWorkNeedsFounder).length,
    employees: AI_EMPLOYEES.map((employee) => ({ ...employee, ...counts(active.filter((item) => item.owner_type === 'ai' && item.assigned_agent === employee.key)) })),
  };
}
