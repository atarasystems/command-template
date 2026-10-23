import { allowMethods, bodyOf, sendData, sendError, throwIfError } from '../_lib/http.js';
import { withCommandAuth } from '../_lib/auth.js';
import { getSupabase } from '../_lib/supabase.js';
import { emailValue, optionalText } from '../_lib/validation.js';

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) return;
  try {
    if (req.method === 'GET') {
      const email = emailValue(req.query.email, false);
      const { data, error } = await getSupabase().from('crm_suppressions').select('*').ilike('email', email).maybeSingle();
      throwIfError(error);
      return sendData(res, { suppressed: Boolean(data), suppression: data });
    }
    const input = bodyOf(req);
    const values = {
      email: emailValue(input.email, false),
      reason: optionalText(input.reason, 'reason', 2000),
      source: optionalText(input.source, 'source', 200),
    };
    const { data, error } = await getSupabase().from('crm_suppressions').upsert(values, { onConflict: 'email' }).select().single();
    throwIfError(error);
    return sendData(res, data, 201);
  } catch (error) {
    return sendError(res, error);
  }
}

export default withCommandAuth(handler);
