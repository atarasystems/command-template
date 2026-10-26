import { withCommandAuth } from '../_lib/auth.js';
import { sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';

async function handler(req,res){
  if(req.method!=='GET') return sendError(res,{code:'METHOD_NOT_ALLOWED',message:'Method not allowed'},405);
  try{
    const id=req.query?.id;
    if(!id) return sendError(res,{code:'VALIDATION_ERROR',message:'id is required'},400);
    const db=getSupabase();
    const row=await db.from('command_application_documents').select('*').eq('id',id).maybeSingle();
    if(row.error) throw row.error;
    let document = row.data;
    if (!document) {
      const vault = await db.from('command_funding_document_versions').select('name,storage_bucket,storage_path,file_url').eq('id',id).maybeSingle();
      if (vault.error) throw vault.error;
      document = vault.data;
    }
    if (!document) return sendError(res,{code:'NOT_FOUND',message:'Document not found'},404);
    if (!document.storage_path && document.funding_document_version_id) {
      const version = await db.from('command_funding_document_versions').select('name,storage_bucket,storage_path,file_url').eq('id',document.funding_document_version_id).single();
      if (version.error) throw version.error;
      document = version.data;
    }
    if(document.storage_bucket && document.storage_path){
      const signed=await db.storage.from(document.storage_bucket).createSignedUrl(document.storage_path,300,{download:document.name});
      if(signed.error) throw signed.error;
      return sendData(res,{url:signed.data.signedUrl,expires_in:300});
    }
    if(document.file_url) return sendData(res,{url:document.file_url,expires_in:null});
    return sendError(res,{code:'NOT_FOUND',message:'No file or link is stored for this document'},404);
  }catch(error){return sendError(res,error)}
}
export default withCommandAuth(handler);
