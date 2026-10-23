import { withCommandAuth } from '../_lib/auth.js';
import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';

const FIELDS = ['fact_key','label','category','value_text','status','source_note','effective_at','last_verified_at','owner'];
const STATUSES = new Set(['current','draft','retired']);
function pick(body = {}) { return Object.fromEntries(FIELDS.filter((key) => Object.hasOwn(body, key)).map((key) => [key, body[key]])); }

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET','POST','PATCH','DELETE'])) return;
  try {
    const db = getSupabase();
    if (req.method === 'GET') {
      let query = db.from('command_company_facts').select('*').order('category').order('label');
      if (req.query?.status) query = query.eq('status', req.query.status);
      const result = await query;
      if (result.error) throw result.error;
      return sendData(res, result.data || []);
    }
    const body = bodyOf(req);
    if (req.method === 'POST') {
      const input = pick(body);
      if (!input.fact_key || !input.label || !input.value_text) return sendError(res, { code:'VALIDATION_ERROR', message:'fact_key, label, and value_text are required' });
      if (input.status && !STATUSES.has(input.status)) return sendError(res, { code:'VALIDATION_ERROR', message:'invalid fact status' });
      const result = await db.from('command_company_facts').insert(input).select().single();
      if (result.error) throw result.error;
      return sendData(res, result.data, 201);
    }
    if (!body.id) return sendError(res, { code:'VALIDATION_ERROR', message:'id is required' });
    if (req.method === 'DELETE') {
      const result = await db.from('command_company_facts').delete().eq('id', body.id).select().single();
      if (result.error) throw result.error;
      return sendData(res, { deleted:true, item:result.data });
    }
    const input = pick(body);
    if (input.status && !STATUSES.has(input.status)) return sendError(res, { code:'VALIDATION_ERROR', message:'invalid fact status' });
    const result = await db.from('command_company_facts').update({ ...input, updated_at:new Date().toISOString() }).eq('id', body.id).select().single();
    if (result.error) throw result.error;
    return sendData(res, result.data);
  } catch (error) { return sendError(res, error); }
}

export default withCommandAuth(handler);
