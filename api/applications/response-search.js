import { withCommandAuth } from '../_lib/auth.js';
import { sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';
import { getAccessToken, gmailConfigured, searchMessages } from '../_lib/gmail.js';

async function handler(req, res) {
  if (req.method !== 'GET') return sendError(res, { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }, 405);
  try {
    if (!gmailConfigured()) return sendError(res, { code: 'GMAIL_NOT_CONFIGURED', message: 'Gmail is not configured.' }, 503);
    const applicationId = String(req.query?.application_id || '');
    const app = await getSupabase().from('command_applications').select('title,organization,submitted_at').eq('id', applicationId).single();
    if (app.error) throw app.error;
    const query = String(req.query?.q || `${app.data.title} ${app.data.organization || ''}`).trim().slice(0, 200);
    return sendData(res, await searchMessages(await getAccessToken(), query, 10));
  } catch (error) { return sendError(res, error); }
}

export default withCommandAuth(handler);
