import { withCommandAuth } from '../_lib/auth.js';
import { buildRadarResult } from '../_lib/intelligence.js';
import { founderSettings } from '../_lib/founder-settings.js';
import { getSupabase } from '../_lib/supabase.js';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  try {
    let settings;
    try { settings = await founderSettings(getSupabase()); } catch { settings = undefined; }
    const data = await buildRadarResult({ settings });
    if (data.allSourcesFailed) return res.status(502).json({ ok: false, error: { code: 'INTELLIGENCE_UNAVAILABLE', message: 'Intelligence refresh is unavailable right now. Try again later.' } });
    return res.status(200).json({ ok: true, data });
  } catch {
    return res.status(502).json({ ok: false, error: { code: 'INTELLIGENCE_UNAVAILABLE', message: 'Intelligence refresh is unavailable right now. Try again later.' } });
  }
}

export default withCommandAuth(handler);
