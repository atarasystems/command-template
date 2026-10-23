import { withCommandAuth } from '../_lib/auth.js';
import { bodyOf, sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';
import { quickAddFunding } from '../_lib/funding-finder.js';

export const maxDuration = 60;

// The founder heard about a program: a name, a link, or a note is enough. It is looked up and saved.
async function handler(req, res) {
  if (req.method !== 'POST') return sendError(res, { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }, 405);
  try {
    const body = bodyOf(req);
    return sendData(res, await quickAddFunding(getSupabase(), body.text));
  } catch (error) {
    console.error('[Funding quick add]', error?.message || error);
    return sendError(res, { code: error.code || 'QUICK_ADD_FAILED', message: error.message || 'That program could not be looked up.' }, error.status || 500);
  }
}

export default withCommandAuth(handler);
