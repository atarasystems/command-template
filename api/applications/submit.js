import { withCommandAuth } from '../_lib/auth.js';
import { sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';

async function handler(req, res) {
  if (req.method !== 'POST') return sendError(res, { code:'METHOD_NOT_ALLOWED', message:'Method not allowed' }, 405);
  try {
    const { application_id } = req.body || {};
    if (!application_id) return sendError(res, { code:'VALIDATION_ERROR', message:'application_id is required' });
    const db = getSupabase();
    const appResult = await db.from('command_applications').select('*').eq('id', application_id).single();
    if (appResult.error) throw appResult.error;
    const answersResult = await db.from('command_application_answers').select('*').eq('application_id', application_id).order('question_order');
    if (answersResult.error) throw answersResult.error;
    const incomplete = (answersResult.data || []).filter((row) => !String(row.answer_text || '').trim());
    if (incomplete.length) return sendError(res, { code:'VALIDATION_ERROR', message:`${incomplete.length} answer${incomplete.length === 1 ? '' : 's'} are blank. Fill them before freezing the submission.` }, 400);
    const now = new Date().toISOString();
    for (const row of answersResult.data || []) {
      if (row.answer_status === 'submitted') continue;
      const update = await db.from('command_application_answers').update({ answer_status:'submitted', submitted_answer_text:row.answer_text, submitted_at:now, updated_at:now }).eq('id', row.id);
      if (update.error) throw update.error;
    }
    const appUpdate = await db.from('command_applications').update({ status:'submitted', submitted_at:appResult.data.submitted_at || now, updated_at:now }).eq('id', application_id).select().single();
    if (appUpdate.error) throw appUpdate.error;
    if (appResult.data.program_opportunity_id) {
      const programUpdate = await db.from('crm_program_opportunities').update({ status:'submitted', submitted_at:appResult.data.submitted_at || now }).eq('id', appResult.data.program_opportunity_id);
      if (programUpdate.error) throw programUpdate.error;
    }
    const documentUpdate = await db.from('command_application_documents').update({ is_submitted:true, association_type:'submitted', submitted_at:now, updated_at:now }).eq('application_id', application_id).eq('is_current', true).eq('association_type','submitted');
    if (documentUpdate.error) throw documentUpdate.error;
    return sendData(res, { application:appUpdate.data, answers_frozen:(answersResult.data || []).length, submitted_at:appUpdate.data.submitted_at });
  } catch (error) { return sendError(res, error); }
}
export default withCommandAuth(handler);
