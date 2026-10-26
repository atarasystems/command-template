import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { withCommandAuth } from '../_lib/auth.js';
import { getSupabase } from '../_lib/supabase.js';
import { insertRow, listRows, updateRow } from '../_lib/records.js';
import { enumValue, optionalText, optionalUuid, booleanValue, pickDefined, requiredText, timestampValue } from '../_lib/validation.js';

const ROLES = ['prospect','client','audit_partner','business_coach','advisor','mentor','referral_partner','strategic_partner','ecosystem_partner','program_contact','investor_funder','vendor','other'];
const editable = {
  contact_id: value => optionalUuid(value, 'contact_id'),
  role: value => enumValue(value, 'role', ROLES),
  source_type: value => optionalText(value, 'source_type', 100),
  source_id: value => optionalText(value, 'source_id', 500),
  active: value => booleanValue(value, 'active'),
  started_at: value => timestampValue(value, 'started_at'),
  ended_at: value => timestampValue(value, 'ended_at'),
  notes: value => optionalText(value, 'notes'),
};

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET','POST','PATCH'])) return;
  try {
    if (req.method === 'GET') {
      const filters = [['contact_id', req.query.contact_id], ['role', req.query.role], ['active', req.query.active]];
      return sendData(res, req.query.id ? await (async () => { const { data, error } = await getSupabase().from('crm_contact_roles').select('*').eq('id', req.query.id).single(); if (error) throw error; return data; })() : await listRows('crm_contact_roles', req.query, { order: 'created_at', filters }));
    }
    const values = pickDefined(bodyOf(req), editable);
    if (req.method === 'POST') {
      values.contact_id = requiredText(values.contact_id, 'contact_id');
      values.role = enumValue(values.role, 'role', ROLES);
      return sendData(res, await insertRow('crm_contact_roles', values), 201);
    }
    return sendData(res, await updateRow('crm_contact_roles', req.query.id, values));
  } catch (error) { return sendError(res, error); }
}
export default withCommandAuth(handler);
