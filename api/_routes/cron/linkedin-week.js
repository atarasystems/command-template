import { founderSettings } from '../_lib/founder-settings.js';
import { getSupabase } from '../_lib/supabase.js';
import { ensureWeek, mondayOf } from '../_lib/linkedin-posts.js';
import { envTimeZone } from '../_lib/founder-settings.js';

export const maxDuration = 120;

// Once a week (vercel.json): next week's three LinkedIn drafts are ready to review.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  if (!process.env.CRON_SECRET || req.headers?.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
  try { await founderSettings(getSupabase()); } catch { /* settings load is best effort */ }
  try {
    const nextWeek = new Date(Date.now() + 7 * 86400000).toLocaleDateString('en-CA', { timeZone: envTimeZone() });
    const out = await ensureWeek(getSupabase(), mondayOf(nextWeek));
    console.log('[LinkedIn week]', JSON.stringify(out));
    return res.status(200).json({ ok: true, data: out });
  } catch (error) {
    console.error('[LinkedIn week]', error.message);
    return res.status(500).json({ ok: false, error: { code: 'LINKEDIN_WEEK_FAILED', message: 'LinkedIn drafts could not be written.' } });
  }
}
