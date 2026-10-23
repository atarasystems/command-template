import { withCommandAuth } from '../_lib/auth.js';
import { client, errorResponse, fields, pick, supabaseError, validateProject } from '../_lib/work.js';
import { requireUuid } from '../_lib/validation.js';

async function handler(req, res) {
  try {
    const db = client();
    if (req.method === 'GET') {
      const { data, error } = await db.from('work_projects').select('*, work_phases(*), work_items(*)').order('status').order('priority');
      if (error) return supabaseError(res, error);
      const projects = (data || []).map((project) => {
        const measurable = (project.work_items || []).filter((item) => item.status !== 'cancelled');
        const completed = measurable.filter((item) => item.status === 'done').length;
        const nextItem = measurable.filter((item) => !['done', 'cancelled'].includes(item.status)).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))[0] || null;
        return { ...project, phases: project.work_phases || [], items: project.work_items || [], progress: measurable.length ? Math.round((completed / measurable.length) * 100) : null, next_item: nextItem };
      });
      return res.status(200).json({ ok: true, data: projects });
    }
    if (req.method === 'DELETE') {
      requireUuid(req.query?.id, 'id');
      const phases = await db.from('work_phases').select('id').eq('project_id', req.query.id).limit(1);
      if (phases.error) return supabaseError(res, phases.error);
      const items = await db.from('work_items').select('id').eq('project_id', req.query.id).limit(1);
      if (items.error) return supabaseError(res, items.error);
      if (phases.data?.length || items.data?.length) return res.status(409).json({ ok: false, error: { code: 'PROJECT_HAS_LINKED_WORK', message: 'This project still has linked work. Remove or move that work before deleting the project.' } });
      const { error } = await db.from('work_projects').delete().eq('id', req.query.id);
      if (error) return supabaseError(res, error);
      return res.status(200).json({ ok: true, data: { deleted: true } });
    }
    if (!['POST', 'PATCH'].includes(req.method)) return res.status(405).json({ ok: false, error: { message: 'Method not allowed' } });
    const body = req.body || {};
    const input = pick(body, fields.projects);
    const validation = validateProject(input, req.method === 'PATCH');
    if (validation) return errorResponse(res, 400, validation);
    if (req.method === 'PATCH') {
      if (!body.id) return errorResponse(res, 400, 'id is required');
      const { data, error } = await db.from('work_projects').update(input).eq('id', body.id).select().single();
      if (error) return supabaseError(res, error);
      return res.status(200).json({ ok: true, data });
    }
    const { data, error } = await db.from('work_projects').insert({ ...input, name: input.name.trim() }).select().single();
    if (error) return supabaseError(res, error);
    return res.status(201).json({ ok: true, data });
  } catch (error) { return supabaseError(res, error); }
}

export default withCommandAuth(handler);
