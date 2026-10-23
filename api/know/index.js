import { withCommandAuth } from '../_lib/auth.js';
import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';
import { refreshNews } from '../_lib/know-news.js';

// Know it: the founder's facts to have ready (statistics, stakeholders). Practice moves each card along simple
// review boxes: a right answer waits longer before it comes back, a miss comes back soon.
const WAIT_DAYS = [0, 1, 3, 7, 14, 30];

export function nextReview(card, right, now = new Date()) {
  const box = right ? Math.min(WAIT_DAYS.length - 1, Number(card.box || 0) + 1) : 0;
  const due = new Date(now.getTime() + (right ? WAIT_DAYS[box] * 86400000 : 10 * 60000));
  return { box, due_at: due.toISOString(), times_seen: Number(card.times_seen || 0) + 1, times_right: Number(card.times_right || 0) + (right ? 1 : 0), updated_at: now.toISOString() };
}

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) return;
  try {
    const db = getSupabase();
    if (req.method === 'GET') {
      let q = db.from('command_knowledge_cards').select('*').eq('status', 'current').order('deck').order('sort_order').order('created_at');
      if (req.query?.deck) q = q.eq('deck', String(req.query.deck));
      const rows = await q.limit(1000);
      if (rows.error) throw rows.error;
      return sendData(res, rows.data || []);
    }
    const body = bodyOf(req);
    if (body.action === 'answer') {
      const answers = Array.isArray(body.answers) ? body.answers : [{ id: body.id, right: body.right }];
      const ids = answers.map((a) => String(a.id || '')).filter(Boolean);
      if (!ids.length) return sendError(res, { code: 'VALIDATION_ERROR', message: 'Nothing to save.' }, 400);
      const found = await db.from('command_knowledge_cards').select('id,box,times_seen,times_right').in('id', ids);
      if (found.error) throw found.error;
      const byId = new Map((found.data || []).map((c) => [c.id, c]));
      for (const a of answers) {
        const card = byId.get(String(a.id));
        if (!card) continue;
        const saved = await db.from('command_knowledge_cards').update(nextReview(card, a.right === true)).eq('id', card.id);
        if (saved.error) throw saved.error;
      }
      return sendData(res, { saved: ids.length });
    }
    // "Take this card out": it stops showing and stops coming up in games. Nothing is deleted.
    if (body.action === 'retire') {
      const id = String(body.id || '');
      if (!id) return sendError(res, { code: 'VALIDATION_ERROR', message: 'Which card?' }, 400);
      const saved = await db.from('command_knowledge_cards').update({ status: 'retired', updated_at: new Date().toISOString() }).eq('id', id);
      if (saved.error) throw saved.error;
      return sendData(res, { retired: id });
    }
    if (body.action === 'refresh_news') return sendData(res, await refreshNews(db));
    return sendError(res, { code: 'VALIDATION_ERROR', message: 'Unknown action.' }, 400);
  } catch (error) { return sendError(res, error); }
}

export default withCommandAuth(handler);
