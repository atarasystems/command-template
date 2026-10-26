import { withCommandAuth } from '../_lib/auth.js';
import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';

const FIELDS = ['application_id','question_order','question_text','topic','max_characters','answer_text','answer_status','submitted_answer_text','submitted_at','source_answer_id','ai_drafted','notes'];
const STATUSES = new Set(['draft','approved','submitted']);
function pick(body = {}) { return Object.fromEntries(FIELDS.filter((key) => Object.hasOwn(body, key)).map((key) => [key, body[key]])); }

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET','POST','PATCH','DELETE'])) return;
  try {
    const db = getSupabase();
    if (req.method === 'GET') {
      let query = db.from('command_application_answers').select('*, command_applications(title,organization,submitted_at,status)').order('updated_at', { ascending: false });
      if (req.query?.application_id) query = query.eq('application_id', req.query.application_id).order('question_order', { ascending: true });
      if (req.query?.topic) query = query.eq('topic', req.query.topic);
      if (req.query?.library === 'true') query = query.in('answer_status', ['approved','submitted']).limit(100);
      const result = await query;
      if (result.error) throw result.error;
      return sendData(res, result.data || []);
    }

    const body = bodyOf(req);
    if (req.method === 'POST') {
      const input = pick(body);
      if (!input.application_id || !input.question_text) return sendError(res, { code:'VALIDATION_ERROR', message:'application_id and question_text are required' });
      if (input.answer_status && !STATUSES.has(input.answer_status)) return sendError(res, { code:'VALIDATION_ERROR', message:'invalid answer status' });
      const result = await db.from('command_application_answers').insert(input).select().single();
      if (result.error) throw result.error;
      return sendData(res, result.data, 201);
    }

    if (!body.id) return sendError(res, { code:'VALIDATION_ERROR', message:'id is required' });
    if (req.method === 'DELETE') {
      const row = await db.from('command_application_answers').select('answer_status').eq('id', body.id).single();
      if (row.error) throw row.error;
      if (row.data?.answer_status === 'submitted') return sendError(res, { code:'SUBMITTED_ANSWER_LOCKED', message:'Submitted answers are frozen and cannot be deleted' }, 409);
      const result = await db.from('command_application_answers').delete().eq('id', body.id).select().single();
      if (result.error) throw result.error;
      return sendData(res, { deleted:true, item:result.data });
    }

    const existing = await db.from('command_application_answers').select('*').eq('id', body.id).single();
    if (existing.error) throw existing.error;
    if (existing.data?.answer_status === 'submitted') return sendError(res, { code:'SUBMITTED_ANSWER_LOCKED', message:'Submitted answers are frozen. Create a new reusable answer instead of changing history.' }, 409);
    const input = pick(body);
    if (input.answer_status && !STATUSES.has(input.answer_status)) return sendError(res, { code:'VALIDATION_ERROR', message:'invalid answer status' });
    if (input.max_characters && input.answer_text && input.answer_text.length > input.max_characters) return sendError(res, { code:'CHARACTER_LIMIT', message:'Answer exceeds the saved character limit' }, 400);
    const result = await db.from('command_application_answers').update({ ...input, updated_at:new Date().toISOString() }).eq('id', body.id).select().single();
    if (result.error) throw result.error;
    return sendData(res, result.data);
  } catch (error) { return sendError(res, error); }
}

export default withCommandAuth(handler);
