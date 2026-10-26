import { withCommandAuth } from '../_lib/auth.js';
import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';
import { applicationSummaryFromResponse, normalizeResponse } from '../_lib/application-responses.js';

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) return;
  try {
    const db = getSupabase();
    if (req.method === 'GET') {
      if (!req.query?.application_id) return sendError(res, { code: 'VALIDATION_ERROR', message: 'application_id is required' });
      const result = await db.from('command_application_responses').select('*').eq('application_id', req.query.application_id).order('response_date', { ascending: true });
      if (result.error) throw result.error;
      return sendData(res, result.data || []);
    }
    const input = normalizeResponse(bodyOf(req));
    if (input.award_amount !== null && (!Number.isFinite(input.award_amount) || input.award_amount < 0)) throw Object.assign(new Error('award_amount must be a non-negative number'), { code: 'VALIDATION_ERROR' });
    const app = await db.from('command_applications').select('*').eq('id', input.application_id).single();
    if (app.error) throw app.error;
    if (input.gmail_message_id) {
      const duplicate = await db.from('command_application_responses').select('id').eq('application_id', input.application_id).eq('gmail_message_id', input.gmail_message_id).limit(1);
      if (duplicate.error) throw duplicate.error;
      if (duplicate.data?.[0]) return sendData(res, duplicate.data[0]);
    }
    const inserted = await db.from('command_application_responses').insert(input).select().single();
    if (inserted.error) throw inserted.error;
    const summary = applicationSummaryFromResponse(inserted.data, app.data);
    const updated = await db.from('command_applications').update({ ...summary, updated_at: new Date().toISOString() }).eq('id', input.application_id).select().single();
    if (updated.error) throw updated.error;
    return sendData(res, { response: inserted.data, application: updated.data }, 201);
  } catch (error) { return sendError(res, error); }
}

export default withCommandAuth(handler);
