import { withCommandAuth } from '../_lib/auth.js';
import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';

// Items the founder removed from Today. GET lists their keys; POST { key, title } hides one; POST { key, restore: true } brings it back.
async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) return;
  try {
    const db = getSupabase();
    if (req.method === 'GET') {
      const rows = await db.from('command_hidden_items').select('item_key').order('hidden_at', { ascending: false }).limit(2000);
      if (rows.error) throw rows.error;
      return sendData(res, (rows.data || []).map((r) => r.item_key));
    }
    const body = bodyOf(req);
    const key = String(body.key || '').trim().slice(0, 300);
    if (!key) return sendError(res, { code: 'VALIDATION_ERROR', message: 'Pick something to remove.' }, 400);
    if (body.restore) {
      const gone = await db.from('command_hidden_items').delete().eq('item_key', key);
      if (gone.error) throw gone.error;
      return sendData(res, { key, hidden: false });
    }
    const saved = await db.from('command_hidden_items').upsert({ item_key: key, title: String(body.title || '').slice(0, 300) || null, hidden_at: new Date().toISOString() }, { onConflict: 'item_key' });
    if (saved.error) throw saved.error;
    return sendData(res, { key, hidden: true });
  } catch (error) { return sendError(res, error); }
}

export default withCommandAuth(handler);
