import { founderSettings } from '../_lib/founder-settings.js';
import { getSupabase } from '../_lib/supabase.js';
import { createReview, easternDate, periodFor, previousMonthRef } from '../_lib/updates.js';

export const maxDuration = 120;

// Runs daily in the evening (vercel.json). On the weekly review day: draft the week in review. The 1st: last month's review.
// Drafts are private (audience "me"). Nothing is sent.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  if (!process.env.CRON_SECRET || req.headers?.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
  try { await founderSettings(getSupabase()); } catch { /* settings load is best effort */ }
  const db = getSupabase();
  const today = easternDate();
  const weekday = new Date(today + 'T12:00:00Z').getUTCDay();
  const jobs = [];
  if (weekday === 5) jobs.push({ kind: 'week', refDate: today });
  if (today.endsWith('-01')) jobs.push({ kind: 'month', refDate: previousMonthRef(today) });
  const results = [];
  for (const job of jobs) {
    const period = periodFor(job.kind, job.refDate);
    const existing = await db.from('command_reviews').select('id').eq('kind', job.kind).eq('audience', 'me').eq('period_start', period.start).is('deleted_at', null).limit(1);
    if (existing.data && existing.data.length) { results.push({ ...job, status: 'exists' }); continue; }
    try { const r = await createReview(db, { kind: job.kind, audience: 'me', refDate: job.refDate }); results.push({ ...job, status: 'drafted', id: r.id }); }
    catch (e) { results.push({ ...job, status: e.code === 'NOTHING_TO_REVIEW' ? 'nothing_to_review' : 'failed' }); if (e.code !== 'NOTHING_TO_REVIEW') console.error('[Reviews cron]', e.message); }
  }
  return res.status(200).json({ ok: true, data: { today, results } });
}
