import { withCommandAuth } from '../_lib/auth.js';
import { generateBriefing, buildBriefingContext } from '../_lib/ceo-briefing.js';
import { getSupabase } from '../_lib/supabase.js';
import { founderSettings } from '../_lib/founder-settings.js';

export const maxDuration = 30;

async function readRows(db) {
  const [workResult, salesResult, programsResult] = await Promise.all([
    db.from('work_items').select('title,status,priority,due_at,cannot_wait,owner_type,owner_name,assigned_agent,notes,work_projects(name)').not('status', 'in', '(done,cancelled)').order('created_at', { ascending: false }).limit(100),
    db.from('crm_opportunities').select('stage,offer_type,opportunity_value,next_action,next_action_at,account:crm_accounts(name)').is('deleted_at', null).order('updated_at', { ascending: false }).limit(50),
    db.from('crm_program_opportunities').select('title,organization,status,deadline_at,notes').not('status', 'eq', 'archived').order('deadline_at', { ascending: true, nullsFirst: false }).limit(50),
  ]);
  for (const result of [workResult, salesResult, programsResult]) {
    if (result.error) throw result.error;
  }
  return {
    work: workResult.data || [],
    sales: salesResult.data || [],
    programs: programsResult.data || [],
    audits: [],
  };
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  try {
    const rows = await readRows(getSupabase());
    const context = buildBriefingContext(rows);
    const briefing = await generateBriefing(context, { settings: await founderSettings(getSupabase()) });
    return res.status(200).json({ ok: true, briefing, generated_at: new Date().toISOString() });
  } catch (error) {
    console.error('[CEO Briefing]', error.message);
    return res.status(500).json({ ok: false, error: { code: 'CEO_BRIEFING_FAILED', message: 'Briefing could not be prepared.' } });
  }
}

export default withCommandAuth(handler);
