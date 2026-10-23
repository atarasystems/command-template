import { withCommandAuth } from '../_lib/auth.js';
import { sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';

const BUCKET = 'personal-docs';
const MAX_BYTES = 3_500_000;
const ALLOWED = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
]);
const MIME_BY_EXTENSION = {
  pdf:'application/pdf', doc:'application/msword', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls:'application/vnd.ms-excel', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt:'application/vnd.ms-powerpoint', pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation', txt:'text/plain',
};
function safeName(value) {
  return String(value || 'document').replace(/[^a-zA-Z0-9._ -]/g,'').replace(/\s+/g,' ').trim().slice(0,120) || 'document';
}
function extensionMime(name='') { return MIME_BY_EXTENSION[String(name).split('.').pop().toLowerCase()] || ''; }
function validation(res, code, message) { return sendError(res, { code, message }, 400); }

async function handler(req,res){
  if(req.method!=='POST') return sendError(res,{code:'METHOD_NOT_ALLOWED',message:'Method not allowed'},405);
  try{
    const { application_id, document_key, name, document_type='other', mime_type, file_base64, notes='' } = req.body || {};
    const suppliedMime=String(mime_type||'').toLowerCase();
    const resolvedMime=ALLOWED.has(suppliedMime) ? suppliedMime : extensionMime(name);
    const encoded=typeof file_base64==='string' ? file_base64.replace(/^data:[^;]+;base64,/,'') : '';
    console.info('[Funding Hub upload validation]', { hasApplicationId:Boolean(application_id), hasDocumentKey:Boolean(document_key), hasName:Boolean(name), suppliedMime:suppliedMime||null, resolvedMime:resolvedMime||null, hasFile:Boolean(encoded), encodedLength:encoded.length });
    if(!application_id && !document_key) return validation(res,'MISSING_DOCUMENT_KEY','Document key is required for a new or replacement funding master.');
    if(!name) return validation(res,'MISSING_FILE_NAME','A file name is required.');
    if(!encoded) return validation(res,'MISSING_FILE','Please choose a file.');
    if(!resolvedMime || !ALLOWED.has(resolvedMime)) return validation(res,'UNSUPPORTED_FILE_TYPE','Unsupported file type. Use PDF, Word, Excel, PowerPoint, or text.');
    let bytes;
    try { bytes=Buffer.from(encoded,'base64'); } catch { return validation(res,'INVALID_FILE','The selected file could not be read. Please choose it again.'); }
    if(!bytes.length) return validation(res,'INVALID_FILE','The selected file could not be read. Please choose it again.');
    if(bytes.length>MAX_BYTES) return validation(res,'FILE_TOO_LARGE','File exceeds the 3.5 MB upload limit.');
    const db=getSupabase();
    const filename=safeName(name);
    if (application_id) {
      const app=await db.from('command_applications').select('id').eq('id',application_id).single();
      if(app.error) throw app.error;
    }
    const path=application_id ? `applications/${application_id}/${Date.now()}-${filename}` : `funding-vault/${safeName(document_key).replace(/\s+/g,'-').toLowerCase()}/${Date.now()}-${filename}`;
    const uploaded=await db.storage.from(BUCKET).upload(path,bytes,{contentType:resolvedMime,upsert:false});
    if(uploaded.error) throw uploaded.error;
    let saved;
    if (application_id) {
      saved=await db.from('command_application_documents').insert({ application_id,name:filename,document_type,storage_bucket:BUCKET,storage_path:path,mime_type:resolvedMime,file_size:bytes.length,is_current:true,association_type:'reference',notes }).select().single();
    } else {
      const current=await db.from('command_funding_document_versions').select('id,version_number').eq('document_key',document_key).eq('status','current').maybeSingle();
      if (current.error) throw current.error;
      const versionNumber=(current.data?.version_number || 0)+1;
      const inserted=await db.from('command_funding_document_versions').insert({ document_key,version_number:versionNumber,name:filename,document_type,storage_bucket:BUCKET,storage_path:path,mime_type:resolvedMime,file_size:bytes.length,status:'current',supersedes_version_id:current.data?.id || null,notes }).select().single();
      if (inserted.error) throw inserted.error;
      if (current.data?.id) {
        const retired=await db.from('command_funding_document_versions').update({status:'superseded',updated_at:new Date().toISOString()}).eq('id',current.data.id);
        if (retired.error) throw retired.error;
      }
      saved=inserted;
    }
    if(saved.error){ await db.storage.from(BUCKET).remove([path]); throw saved.error; }
    return sendData(res,saved.data,201);
  }catch(error){return sendError(res,error)}
}
export default withCommandAuth(handler);
