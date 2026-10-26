import { withCommandAuth } from '../_lib/auth.js';
import { bodyOf, sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';
import { researchFundingOpportunity, researchDuplicate } from '../_lib/funding-research.js';

async function handler(req, res) {
  if (req.method !== 'POST') return sendError(res, { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }, 405);
  try {
    const preview = await researchFundingOpportunity({ input: bodyOf(req) });
    const records = await getSupabase().from('crm_program_opportunities').select('*').limit(500);
    if (records.error) throw records.error;
    const existing = researchDuplicate(records.data || [], preview);
    return sendData(res, { preview, existing: existing ? { id: existing.id, title: existing.title, status: existing.status, funding_intent: existing.funding_intent } : null, saved: false });
  } catch (error) { return sendError(res, error); }
}

export default withCommandAuth(handler);
