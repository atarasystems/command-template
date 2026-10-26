import { founderSettings } from '../_lib/founder-settings.js';
import { getSupabase } from '../_lib/supabase.js';
import { checkWatchedFunding, findFunding, fundingDeadlineHeadsUp, recordScoutRun } from '../_lib/funding-finder.js';

export const maxDuration = 300;

// Every morning: deadline reminders first (fast, never skipped), then the search for new funding.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  if (!process.env.CRON_SECRET || req.headers?.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
  try { await founderSettings(getSupabase()); } catch { /* settings load is best effort */ }
  const db = getSupabase();
  const out = {};
  try { out.reminders = await fundingDeadlineHeadsUp(db); } catch (error) { console.error('[Funding reminders]', error.message); out.reminders = { error: error.message }; }
  try { out.watching = await checkWatchedFunding(db); } catch (error) { console.error('[Funding watch]', error.message); out.watching = { error: error.message }; }
  try { out.finder = await findFunding(db); } catch (error) { console.error('[Funding finder]', error.message); out.finder = { error: error.message }; }
  try { out.health = await recordScoutRun(db, out.finder?.error ? { added: 0, search_error: out.finder.error } : out.finder); } catch (error) { console.error('[Funding health]', error.message); }
  console.log('[Funding]', JSON.stringify(out));
  return res.status(200).json({ ok: true, data: out });
}
