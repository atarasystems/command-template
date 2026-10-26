import { withCommandAuth } from '../_lib/auth.js';
import { client, errorResponse, fields, pick, supabaseError, validatePhase } from '../_lib/work.js';
import { requireUuid } from '../_lib/validation.js';

async function handler(req, res) {
  try {
    const db = client();
    if (req.method === 'GET') {
      let query = db.from('work_phases').select('*').order('sort_order').order('created_at');
      if (req.query?.project_id) query = query.eq('project_id', req.query.project_id);
      const { data, error } = await query;
      if (error) return supabaseError(res, error);
      return res.status(200).json({ ok: true, data: data || [] });
    }
    if (req.method === 'DELETE') {
      requireUuid(req.query?.id, 'id');
      const { error } = await db.from('work_phases').delete().eq('id', req.query.id);
      if (error) return supabaseError(res, error);
      return res.status(200).json({ ok: true, data: { deleted: true } });
    }
    if (!['POST', 'PATCH'].includes(req.method)) return res.status(405).json({ ok: false, error: { message: 'Method not allowed' } });
    const body = req.body || {}; const input = pick(body, fields.phases);
    const validation = validatePhase(input, req.method === 'PATCH');
    if (validation) return errorResponse(res, 400, validation);
    if (req.method === 'PATCH') {
      if (!body.id) return errorResponse(res, 400, 'id is required');
      const { data, error } = await db.from('work_phases').update(input).eq('id', body.id).select().single();
      if (error) return supabaseError(res, error);
      return res.status(200).json({ ok: true, data });
    }
    const { data, error } = await db.from('work_phases').insert({ ...input, name: input.name.trim() }).select().single();
    if (error) return supabaseError(res, error);
    return res.status(201).json({ ok: true, data });
  } catch (error) { return supabaseError(res, error); }
}
export default withCommandAuth(handler);
