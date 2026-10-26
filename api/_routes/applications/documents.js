import { withCommandAuth } from '../_lib/auth.js';
import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';

const FIELDS = ['application_id','living_doc_id','export_document_id','funding_document_version_id','association_type','name','document_type','file_url','storage_bucket','storage_path','mime_type','file_size','is_current','is_submitted','submitted_at','notes'];
function pick(body = {}) { return Object.fromEntries(FIELDS.filter((key) => Object.hasOwn(body, key)).map((key) => [key, body[key]])); }

async function assertApplicationEditable(db, applicationId) {
  if (!applicationId) return;
  const app = await db.from('command_applications').select('status').eq('id', applicationId).single();
  if (app.error) throw app.error;
  if (['submitted', 'awaiting_response', 'interview', 'awarded', 'not_selected'].includes(app.data.status)) throw Object.assign(new Error('Submitted application documents are frozen'), { code: 'SUBMITTED_DOCUMENT_LOCKED' });
}

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET','POST','PATCH','DELETE'])) return;
  try {
    const db = getSupabase();
    if (req.method === 'GET') {
      if (req.query?.library === 'true') {
        const [living, exports, funding, legacy] = await Promise.all([
          db.from('command_living_docs').select('id,name,document_type,business_area,canonical_live_link,purpose,is_canonical,needs_update,last_materially_updated_at').order('updated_at',{ascending:false}),
          db.from('command_export_documents').select('id,living_doc_id,name,export_type,file_url,is_current,exported_at,notes').order('exported_at',{ascending:false}),
          db.from('command_funding_document_versions').select('*').order('document_key').order('version_number',{ascending:false}),
          db.from('command_application_documents').select('*').is('application_id', null).order('updated_at',{ascending:false}),
        ]);
        if (living.error) throw living.error;
        if (exports.error) throw exports.error;
        if (funding.error && !['42P01', '42703'].includes(funding.error.code)) throw funding.error;
        if (legacy.error) throw legacy.error;
        return sendData(res, { living_docs:living.data || [], exports:exports.data || [], funding_versions:funding.error ? [] : funding.data || [], legacy_documents:legacy.data || [] });
      }
      let query = db.from('command_application_documents').select('*').order('created_at');
      if (req.query?.application_id) query = query.eq('application_id',req.query.application_id);
      const result = await query;
      if (result.error) throw result.error;
      return sendData(res,result.data || []);
    }
    const body = bodyOf(req);
    if (req.method === 'POST') {
      const input = pick(body);
      if (!input.application_id || !input.name) return sendError(res,{code:'VALIDATION_ERROR',message:'application_id and name are required'});
      await assertApplicationEditable(db, input.application_id);
      const result = await db.from('command_application_documents').insert(input).select().single();
      if (result.error) throw result.error;
      return sendData(res,result.data,201);
    }
    if (!body.id) return sendError(res,{code:'VALIDATION_ERROR',message:'id is required'});
    if (req.method === 'DELETE') {
      const existing = await db.from('command_application_documents').select('*').eq('id',body.id).single();
      if (existing.error) throw existing.error;
      await assertApplicationEditable(db, existing.data?.application_id);
      if (existing.data?.is_submitted) return sendError(res,{code:'SUBMITTED_DOCUMENT_LOCKED',message:'Submitted application documents are frozen'},409);
      if (existing.data?.storage_bucket && existing.data?.storage_path) {
        const removed = await db.storage.from(existing.data.storage_bucket).remove([existing.data.storage_path]);
        if (removed.error) throw removed.error;
      }
      const result = await db.from('command_application_documents').delete().eq('id',body.id).select().single();
      if (result.error) throw result.error;
      return sendData(res,{deleted:true,item:result.data});
    }
    const input = pick(body);
    const existing = await db.from('command_application_documents').select('application_id,is_submitted').eq('id',body.id).single();
    if (existing.error) throw existing.error;
    await assertApplicationEditable(db, existing.data?.application_id);
    if (existing.data?.is_submitted) return sendError(res,{code:'SUBMITTED_DOCUMENT_LOCKED',message:'Submitted application documents are frozen'},409);
    const result = await db.from('command_application_documents').update({...input,updated_at:new Date().toISOString()}).eq('id',body.id).select().single();
    if (result.error) throw result.error;
    return sendData(res,result.data);
  } catch (error) { return sendError(res,error); }
}
export default withCommandAuth(handler);
