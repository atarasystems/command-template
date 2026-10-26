import { withCommandAuth } from '../_lib/auth.js';
import { client, isActionable, itemSignal, supabaseError, todayRank } from '../_lib/work.js';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: { message: 'Method not allowed' } });
  try {
    const { data, error } = await client().from('work_items').select('*, work_projects(name), work_phases(name)').order('created_at', { ascending: false });
    if (error) return supabaseError(res, error);
    const now = new Date();
    const items = (data || []).filter((item) => isActionable(item, now)).sort((a, b) => {
      const ar = todayRank(a, now); const br = todayRank(b, now);
      for (let i = 0; i < ar.length; i += 1) if (ar[i] !== br[i]) return ar[i] - br[i];
      return 0;
    }).map((item) => ({ ...item, signal: itemSignal(item, now), project_name: item.work_projects?.name || null, phase_name: item.work_phases?.name || null }));
    const limit = Math.min(Math.max(Number(req.query?.limit) || 10, 1), 50);
    return res.status(200).json({ ok: true, data: items.slice(0, limit), total: items.length });
  } catch (error) { return supabaseError(res, error); }
}
export default withCommandAuth(handler);
