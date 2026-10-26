import { founderSettings } from '../_lib/founder-settings.js';
import { getSupabase } from '../_lib/supabase.js';
import { gmailConfigured } from '../_lib/gmail.js';
import { runEmailTriage } from '../_lib/email-triage.js';
import { aiProvider } from '../_lib/ai.js';
import { scanCalendar } from '../_lib/heads-up.js';

export const maxDuration = 300;

// On its schedule in vercel.json (daily on the free plan, every 30 minutes on Pro): read new inbox email, sort it, draft replies, add tasks, and read upcoming events for Heads up. Nothing is sent.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  if (!process.env.CRON_SECRET || req.headers?.authorization !== `Bearer ${process.env.CRON_SECRET}`) return res.status(401).json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
  try { await founderSettings(getSupabase()); } catch { /* settings load is best effort */ }
  if (!gmailConfigured()) return res.status(200).json({ ok: true, data: { skipped: 'gmail_not_configured' } });
  // The email assistant runs on Gemini only, to keep costs low.
  if (aiProvider() !== 'gemini') return res.status(200).json({ ok: true, data: { skipped: 'gemini_not_connected' } });
  const db = getSupabase();
  try {
    const any = await db.from('command_email_triage').select('id', { count: 'exact', head: true });
    const days = any.count ? 3 : 7; // the first run looks back a week
    const data = await runEmailTriage(db, { days });
    // Then read upcoming calendar events for anything easy to miss.
    data.heads_up = await scanCalendar(db).catch((e) => ({ failed: e.message }));
    return res.status(200).json({ ok: true, data });
  } catch (e) {
    console.error('[Email triage cron]', e.message);
    return res.status(500).json({ ok: false, error: { code: 'EMAIL_TRIAGE_FAILED', message: e.message } });
  }
}
