import { withCommandAuth } from '../_lib/auth.js';
import { client, supabaseError } from '../_lib/work.js';
import { AI_EMPLOYEES, aiWorkNeedsFounder, getAiEmployee, summarizeAiTeam } from '../_lib/ai-team.js';

const WORK_SELECT = 'id,title,project_id,phase_id,category,status,priority,due_at,defer_until,owner_type,owner_name,assigned_agent,source_type,source_id,notes,created_at,updated_at,work_projects(name),work_phases(name)';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: { message: 'Method not allowed' } });
  try {
    const agent = req.query?.agent || null;
    if (agent && !getAiEmployee(agent)) return res.status(400).json({ ok: false, error: { code: 'INVALID_AGENT', message: 'Unsupported AI employee' } });
    const { data, error } = await client().from('work_items').select(WORK_SELECT).order('created_at', { ascending: false });
    if (error) return supabaseError(res, error);
    const active = (data || []).filter((item) => !['done', 'cancelled'].includes(item.status));
    const items = agent ? active.filter((item) => item.owner_type === 'ai' && item.assigned_agent === agent).map((item) => ({
      id: item.id, title: item.title, project_name: item.work_projects?.name || null, category: item.category,
      priority: item.priority, status: item.status, due_at: item.due_at || null, notes: item.notes || null,
      source_type: item.source_type || null, source_id: item.source_id || null, assigned_agent: item.assigned_agent,
    })) : [];
    const needsFounder = active.filter(aiWorkNeedsFounder).map((item) => ({
      id: item.id, title: item.title, project_name: item.work_projects?.name || null, category: item.category,
      priority: item.priority, status: item.status, due_at: item.due_at || null, notes: item.notes || null,
    }));
    return res.status(200).json({ ok: true, data: { ...summarizeAiTeam(data || []), selected_agent: agent, items, needs_founder: needsFounder } });
  } catch (error) { return supabaseError(res, error); }
}

export default withCommandAuth(handler);
