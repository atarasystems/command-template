import { founderSettings } from '../_lib/founder-settings.js';
import { getSupabase } from '../_lib/supabase.js';
import { refreshNews } from '../_lib/know-news.js';

export const maxDuration = 120;

// Each morning: fresh news cards for Know it, on the topics the founder chose.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  if (!process.env.CRON_SECRET || req.headers?.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
  try { await founderSettings(getSupabase()); } catch { /* settings load is best effort */ }
  try {
    const out = await refreshNews(getSupabase());
    console.log('[Know news]', JSON.stringify(out));
    return res.status(200).json({ ok: true, data: out });
  } catch (error) {
    console.error('[Know news]', error.message);
    return res.status(500).json({ ok: false, error: { code: 'KNOW_NEWS_FAILED', message: error.message } });
  }
}
