import { withCommandAuth } from '../_lib/auth.js';
import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';
import { applicationWorkValues } from '../_lib/work.js';
import { createPrepItems } from '../_lib/funding-prep.js';

const FIELDS = ['program_opportunity_id','title','organization','application_type','application_url','status','deadline_at','submitted_at','response_expected_at','notes'];
const STATUSES = new Set(['draft','in_progress','submitted','awaiting_response','interview','awarded','not_selected','archived']);

function pick(body = {}) {
  return Object.fromEntries(FIELDS.filter((key) => Object.hasOwn(body, key)).map((key) => [key, body[key]]));
}

async function chooseToApply(db, opportunityId) {
  const opportunity = await db.from('crm_program_opportunities').select('*').eq('id', opportunityId).single();
  if (opportunity.error) throw opportunity.error;
  const updatedOpportunity = await db.from('crm_program_opportunities').update({ funding_intent: 'chosen', status: ['discovered', 'reviewing'].includes(opportunity.data.status) ? 'apply' : opportunity.data.status, updated_at: new Date().toISOString() }).eq('id', opportunityId).select('*').single();
  if (updatedOpportunity.error) throw updatedOpportunity.error;
  const existing = await db.from('command_applications').select('*').eq('program_opportunity_id', opportunityId).order('created_at', { ascending: true }).limit(1);
  if (existing.error) throw existing.error;
  let application = existing.data?.[0] || null;
  if (!application) {
    const created = await db.from('command_applications').insert({
      program_opportunity_id: opportunityId,
      title: opportunity.data.title,
      organization: opportunity.data.organization,
      application_type: opportunity.data.opportunity_type,
      application_url: opportunity.data.source_url,
      status: 'in_progress',
      deadline_at: opportunity.data.deadline_at,
      response_expected_at: opportunity.data.response_expected_at,
    }).select().single();
    if (created.error) throw created.error;
    application = created.data;
  }
  // The program's checklist becomes her prep list, with due dates.
  try { await createPrepItems(db, updatedOpportunity.data); } catch (error) { console.error('[Funding prep]', error.message); }
  const work = await db.from('work_items').select('*').eq('source_type', 'program_opportunity').eq('source_id', opportunityId).limit(1);
  if (work.error) throw work.error;
  if (!work.data?.[0]) {
    const createdWork = await db.from('work_items').insert({ ...applicationWorkValues(opportunity.data), category: 'grant', status: 'open', priority: 'next', owner_type: 'founder', owner_name: null, source_type: 'program_opportunity', source_id: opportunityId }).select().single();
    if (createdWork.error) throw createdWork.error;
  }
  return { opportunity: updatedOpportunity.data, application };
}

async function returnToOptions(db, applicationId) {
  const app = await db.from('command_applications').select('*').eq('id', applicationId).single();
  if (app.error) throw app.error;
  if (['submitted', 'awaiting_response', 'interview', 'awarded', 'not_selected'].includes(app.data.status)) throw Object.assign(new Error('Submitted application history cannot return to Options'), { code: 'SUBMITTED_APPLICATION_LOCKED' });
  const updated = await db.from('command_applications').update({ status: 'draft', updated_at: new Date().toISOString() }).eq('id', applicationId).select().single();
  if (updated.error) throw updated.error;
  if (app.data.program_opportunity_id) {
    const opportunity = await db.from('crm_program_opportunities').update({ funding_intent: 'option', status: 'reviewing', updated_at: new Date().toISOString() }).eq('id', app.data.program_opportunity_id);
    if (opportunity.error) throw opportunity.error;
    const work = await db.from('work_items').select('id,status,notes').eq('source_type', 'program_opportunity').eq('source_id', app.data.program_opportunity_id).in('status', ['open', 'in_progress']).limit(1);
    if (work.error) throw work.error;
    if (work.data?.[0]) await db.from('work_items').update({ status: 'cancelled', notes: `${work.data[0].notes || ''}\nReturned to Funding Options; draft application retained.`.trim() }).eq('id', work.data[0].id);
  }
  return updated.data;
}

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET','POST','PATCH','DELETE'])) return;
  try {
    const db = getSupabase();
    if (req.method === 'GET') {
      if (req.query?.id) {
        const app = await db.from('command_applications').select('*, crm_program_opportunities(title,organization,status,deadline_at,source_url)').eq('id', req.query.id).single();
        if (app.error) throw app.error;
        const [answers, docs] = await Promise.all([
          db.from('command_application_answers').select('*').eq('application_id', req.query.id).order('question_order', { ascending: true }),
          db.from('command_application_documents').select('*').eq('application_id', req.query.id).order('created_at', { ascending: true }),
        ]);
        const responses = await db.from('command_application_responses').select('*').eq('application_id', req.query.id).order('response_date', { ascending: true });
        if (answers.error) throw answers.error;
        if (docs.error) throw docs.error;
        if (responses.error && responses.error.code !== '42P01') throw responses.error;
        return sendData(res, { ...app.data, answers: answers.data || [], documents: docs.data || [], responses: responses.data || [] });
      }
      const result = await db.from('command_applications').select('*, crm_program_opportunities(status,deadline_at,source_url)').order('deadline_at', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false });
      if (result.error) throw result.error;
      return sendData(res, result.data || []);
    }

    const body = bodyOf(req);
    if (req.method === 'POST' && body.action === 'choose_to_apply') {
      if (!body.program_opportunity_id) return sendError(res, { code: 'VALIDATION_ERROR', message: 'program_opportunity_id is required' });
      return sendData(res, await chooseToApply(db, body.program_opportunity_id), 200);
    }
    if (req.method === 'POST' && body.action === 'return_to_options') {
      if (!body.id) return sendError(res, { code: 'VALIDATION_ERROR', message: 'id is required' });
      return sendData(res, { application: await returnToOptions(db, body.id) });
    }
    if (req.method === 'POST') {
      const input = pick(body);
      if (!input.title) return sendError(res, { code: 'VALIDATION_ERROR', message: 'title is required' });
      if (input.status && !STATUSES.has(input.status)) return sendError(res, { code: 'VALIDATION_ERROR', message: 'invalid status' });
      const result = await db.from('command_applications').insert(input).select().single();
      if (result.error) throw result.error;
      return sendData(res, result.data, 201);
    }

    if (!body.id) return sendError(res, { code: 'VALIDATION_ERROR', message: 'id is required' });
    if (req.method === 'DELETE') {
      const result = await db.from('command_applications').delete().eq('id', body.id).select().single();
      if (result.error) throw result.error;
      return sendData(res, { deleted: true, item: result.data });
    }

    const input = pick(body);
    if (input.status && !STATUSES.has(input.status)) return sendError(res, { code: 'VALIDATION_ERROR', message: 'invalid status' });
    const result = await db.from('command_applications').update({ ...input, updated_at: new Date().toISOString() }).eq('id', body.id).select().single();
    if (result.error) throw result.error;
    return sendData(res, result.data);
  } catch (error) {
    return sendError(res, error);
  }
}

export default withCommandAuth(handler);
