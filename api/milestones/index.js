import { withCommandAuth } from '../_lib/auth.js';
import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';

const FIELDS = ['title', 'due_date', 'category', 'notes', 'status'];

function pick(body) {
  return Object.fromEntries(FIELDS.filter((key) => Object.hasOwn(body, key)).map((key) => [key, body[key]]));
}

// Milestones live in Supabase (command_milestones). The old Command sheet list is retired.
async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST', 'PATCH', 'DELETE'])) return;
  try {
    const db = getSupabase();
    if (req.method === 'GET') {
      let query = db.from('command_milestones').select('*').order('due_date', { ascending: true });
      if (req.query?.status !== 'all') query = query.eq('status', 'upcoming');
      const result = await query;
      if (result.error) throw result.error;
      return sendData(res, result.data || []);
    }
    const body = bodyOf(req);
    if (req.method === 'POST') {
      const values = pick(body);
      if (!values.title || !/^\d{4}-\d{2}-\d{2}$/.test(String(values.due_date || ''))) return sendError(res, { code: 'VALIDATION_ERROR', message: 'title and due_date (YYYY-MM-DD) are required' });
      const result = await db.from('command_milestones').insert(values).select().single();
      if (result.error) throw result.error;
      return sendData(res, result.data, 201);
    }
    if (!body.id) return sendError(res, { code: 'VALIDATION_ERROR', message: 'id is required' });
    if (req.method === 'DELETE') {
      const result = await db.from('command_milestones').update({ status: 'cancelled', updated_at: new Date().toISOString() }).eq('id', body.id).select().single();
      if (result.error) throw result.error;
      return sendData(res, result.data);
    }
    const result = await db.from('command_milestones').update({ ...pick(body), updated_at: new Date().toISOString() }).eq('id', body.id).select().single();
    if (result.error) throw result.error;
    return sendData(res, result.data);
  } catch (error) {
    return sendError(res, error);
  }
}

export default withCommandAuth(handler);
