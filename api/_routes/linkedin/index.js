import { withCommandAuth } from '../_lib/auth.js';
import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';
import { BRAIN_KEY, POST_TYPES, defaultBrain, ensureWeek, mondayOf, readBrain, rewritePost } from '../_lib/linkedin-posts.js';
import { envTimeZone, founderSettings, linkedinTopics } from '../_lib/founder-settings.js';

export const maxDuration = 120;

function today() { return new Date().toLocaleDateString('en-CA', { timeZone: envTimeZone() }); }
function addDays(k, n) { const d = new Date(`${k}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) return;
  try {
    const db = getSupabase();
    if (req.method === 'GET') {
      const rows = await db.from('command_linkedin_posts').select('*').gte('post_date', addDays(today(), -14)).order('post_date');
      if (rows.error) throw rows.error;
      const settings = await founderSettings(db);
      const topics = linkedinTopics(settings);
      return sendData(res, { posts: (rows.data || []).map((p) => ({ ...p, type_label: POST_TYPES[p.post_type]?.label || p.post_type, topic_label: topics[p.topic] ? topics[p.topic].replace(/\s*\(.*$/, '') : p.topic })), brain: await readBrain(db, settings), default_brain: defaultBrain(settings), today: today() });
    }
    const body = bodyOf(req);
    const now = new Date().toISOString();
    if (body.action === 'write_week') {
      const monday = mondayOf(body.week === 'next' ? addDays(today(), 7) : today());
      return sendData(res, await ensureWeek(db, monday));
    }
    if (body.action === 'rewrite') return sendData(res, await rewritePost(db, body.id, String(body.note || '').slice(0, 500)));
    if (body.action === 'save') {
      const saved = await db.from('command_linkedin_posts').update({ body: String(body.body || ''), updated_at: now }).eq('id', body.id).select('*').single();
      if (saved.error) throw saved.error;
      return sendData(res, saved.data);
    }
    if (body.action === 'status' && ['draft', 'approved', 'posted', 'skipped'].includes(body.status)) {
      const saved = await db.from('command_linkedin_posts').update({ status: body.status, posted_at: body.status === 'posted' ? now : null, updated_at: now }).eq('id', body.id).select('*').single();
      if (saved.error) throw saved.error;
      // Posted or skipped: the Today reminder for that day is done.
      if (['posted', 'skipped'].includes(body.status)) await db.from('command_heads_up').update({ acknowledged_at: now }).eq('source_id', `linkedin:${saved.data.post_date}`);
      return sendData(res, saved.data);
    }
    if (body.action === 'save_brain') {
      const saved = await db.from('command_notes').upsert({ note_key: BRAIN_KEY, body: String(body.brain || '').slice(0, 20000), updated_at: now }, { onConflict: 'note_key' });
      if (saved.error) throw saved.error;
      return sendData(res, { saved: true });
    }
    return sendError(res, { code: 'VALIDATION_ERROR', message: 'Unknown action' }, 400);
  } catch (error) { return sendError(res, error); }
}
export default withCommandAuth(handler);
