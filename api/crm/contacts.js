import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { withCommandAuth } from '../_lib/auth.js';
import { insertRow, listRows, updateRow } from '../_lib/records.js';
import { getSupabase } from '../_lib/supabase.js';
import { booleanValue, emailValue, enumValue, fail, optionalText, optionalUuid, pickDefined } from '../_lib/validation.js';

// Areas are the founder's brands from setup, stored as short tags. Interests are a general list.
const INTERESTS = ['client', 'consulting', 'partnership', 'networking', 'funding', 'vendor', 'other'];
const CAPTURE_STATUSES = ['complete', 'unfinished'];
const CONTACT_STATUSES = ['new', 'follow_up_needed', 'done', 'not_needed'];

function areasValue(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail('areas must be an array');
  const areas = [...new Set(value)];
  if (areas.some(area => typeof area !== 'string' || !area.trim() || area.length > 80)) fail('each area must be a short name');
  return areas;
}

const editable = {
  account_id: value => optionalUuid(value, 'account_id'),
  first_name: value => optionalText(value, 'first_name', 150),
  last_name: value => optionalText(value, 'last_name', 150),
  full_name: value => optionalText(value, 'full_name', 300),
  email: value => emailValue(value),
  phone: value => optionalText(value, 'phone', 100),
  website: value => optionalText(value, 'website', 2000),
  job_title: value => optionalText(value, 'job_title', 300),
  linkedin_url: value => optionalText(value, 'linkedin_url', 2000),
  alignable_url: value => optionalText(value, 'alignable_url', 2000),
  notes: value => optionalText(value, 'notes'),
  next_action: value => optionalText(value, 'next_action', 1000),
  next_action_at: value => value ? new Date(value).toISOString() : null,
  archived_at: value => value ? new Date(value).toISOString() : null,
  is_primary: value => booleanValue(value, 'is_primary'),
  areas: areasValue,
  interest: value => enumValue(value, 'interest', INTERESTS, true),
  capture_status: value => enumValue(value, 'capture_status', CAPTURE_STATUSES),
  contact_status: value => enumValue(value, 'contact_status', CONTACT_STATUSES),
};

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST', 'PATCH'])) return;
  try {
    if (req.method === 'GET') {
      const rows = await listRows('crm_contacts', req.query, {
        select: '*, account:crm_accounts(id,name)',
        filters: [['account_id', req.query.account_id]],
      });
      const roleResult = await getSupabase().from('crm_contact_roles').select('contact_id,role').eq('active', true);
      if (roleResult.error) throw roleResult.error;
      const roleByContact = new Map((roleResult.data || []).map(row => [row.contact_id, row.role]));
      rows.forEach(row => { row.relationship_type = roleByContact.get(row.id) || null; });
      const search = String(req.query.search || '').trim().toLowerCase();
      const activeRows = rows.filter(row => !row.archived_at);
      return sendData(res, search ? activeRows.filter(row => [row.full_name, row.first_name, row.last_name, row.email, row.job_title, row.notes, row.account?.name].join(' ').toLowerCase().includes(search)) : activeRows);
    }
    if (req.method === 'PATCH' && req.query.action === 'archive') {
      return sendData(res, await updateRow('crm_contacts', req.query.id, { archived_at: new Date().toISOString() }, '*, account:crm_accounts(id,name)'));
    }
    const input = bodyOf(req);
    if (req.method === 'POST' && input.account_name && !input.account_id) {
      const accountName = optionalText(input.account_name, 'account_name', 300);
      const db = getSupabase();
      const existing = await db.from('crm_accounts').select('id').ilike('name', accountName).limit(1).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data) input.account_id = existing.data.id;
      else {
        const created = await db.from('crm_accounts').insert({ name: accountName, account_type: 'business' }).select('id').single();
        if (created.error) throw created.error;
        input.account_id = created.data.id;
      }
    }
    const values = pickDefined(input, editable);
    return sendData(res, req.method === 'POST'
      ? await insertRow('crm_contacts', values, '*, account:crm_accounts(id,name)')
      : await updateRow('crm_contacts', req.query.id, values, '*, account:crm_accounts(id,name)'),
    req.method === 'POST' ? 201 : 200);
  } catch (error) {
    return sendError(res, error);
  }
}

export default withCommandAuth(handler);
