import { withCommandAuth } from '../_lib/auth.js';
import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';
import { kitState } from '../_lib/funding-prep.js';

// Ready Kit: registrations and documents reused across applications, and when each needs a refresh.
async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'PATCH'])) return;
  try {
    const db = getSupabase();
    if (req.method === 'GET') {
      const rows = await db.from('command_funding_kit').select('*').order('sort');
      if (rows.error) throw rows.error;
      return sendData(res, (rows.data || []).map((r) => ({ ...r, state: kitState(r) })));
    }
    const body = bodyOf(req);
    if (!body.key) return sendError(res, { code: 'VALIDATION_ERROR', message: 'key is required' }, 400);
    const patch = {};
    if (typeof body.value === 'string') patch.value = body.value.trim().slice(0, 500);
    if (typeof body.notes === 'string') patch.notes = body.notes.trim().slice(0, 2000);
    if (body.done === true) Object.assign(patch, { status: 'ready', last_updated_at: new Date().toISOString() });
    if (body.done === false) Object.assign(patch, { status: 'not_started', last_updated_at: null });
    const saved = await db.from('command_funding_kit').update(patch).eq('key', body.key).select('*').single();
    if (saved.error) throw saved.error;
    return sendData(res, { ...saved.data, state: kitState(saved.data) });
  } catch (error) { return sendError(res, error); }
}
export default withCommandAuth(handler);
