import { withCommandAuth } from '../_lib/auth.js';
import { getSupabase } from '../_lib/supabase.js';
import { normalizeOpportunityHub } from '../_lib/opportunity-hub.js';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: { message: 'Method not allowed' } });
  try {
    const db = getSupabase();
    const [commercial, programs, work] = await Promise.all([
      db.from('crm_opportunities').select('*, account:crm_accounts(*), contact:crm_contacts(*)').is('deleted_at', null),
      db.from('crm_program_opportunities').select('*, crm_accounts(*), crm_contacts(*)').neq('status', 'archived'),
      db.from('work_items').select('id,title,status,due_at,owner_name,source_type,source_id').in('source_type', ['crm_opportunity', 'opportunity', 'program_opportunity']),
    ]);
    for (const result of [commercial, programs, work]) if (result.error) throw result.error;
    const rows = normalizeOpportunityHub({ commercial: commercial.data, programs: programs.data, workItems: work.data });
    return res.status(200).json({ ok: true, data: rows });
  } catch (error) {
    return res.status(502).json({ ok: false, error: { message: error.message || 'Opportunity Hub unavailable' } });
  }
}

export default withCommandAuth(handler);
