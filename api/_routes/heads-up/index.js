import { withCommandAuth } from '../_lib/auth.js';
import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';
import { aiProvider } from '../_lib/ai.js';
import { scanCalendar, upcomingHeadsUp } from '../_lib/heads-up.js';

export const maxDuration = 300;

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) return;
  try {
    const db = getSupabase();
    if (req.method === 'GET') return sendData(res, await upcomingHeadsUp(db, { days: Math.min(Number(req.query?.days) || 7, 30) }));
    const body = bodyOf(req);
    const now = new Date().toISOString();
    if (body.action === 'scan_now') {
      if (aiProvider() !== 'gemini') return sendError(res, { code: 'GEMINI_NOT_CONNECTED', message: 'Add the Gemini key to Command first.' }, 503);
      return sendData(res, await scanCalendar(db));
    }
    const current = await db.from('command_heads_up').select('*').eq('id', String(body.id || '')).maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) return sendError(res, { code: 'NOT_FOUND', message: 'That heads up is gone.' }, 404);
    let patch = null;
    if (body.action === 'got_it') patch = { acknowledged_at: now };
    if (body.action === 'not_relevant' || body.action === 'remove') patch = { dismissed_at: now };
    if (body.action === 'prep_done') {
      const prep = Array.isArray(current.data.prep) ? current.data.prep.slice() : [];
      const n = Number(body.index);
      if (!prep[n]) return sendError(res, { code: 'NOT_FOUND', message: 'That step is gone.' }, 404);
      prep[n] = { ...prep[n], done: body.done !== false };
      patch = { prep };
    }
    if (!patch) return sendError(res, { code: 'VALIDATION_ERROR', message: 'Unknown action' });
    const saved = await db.from('command_heads_up').update({ ...patch, updated_at: now }).eq('id', current.data.id).select('*').single();
    if (saved.error) throw saved.error;
    return sendData(res, saved.data);
  } catch (error) {
    console.error('[Heads up]', error?.message || error);
    return sendError(res, error);
  }
}

export default withCommandAuth(handler);
