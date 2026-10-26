import { withCommandAuth } from '../_lib/auth.js';
import { bodyOf, sendData, sendError } from '../_lib/http.js';
import { ingestFundingWatch } from '../_lib/funding-watch.js';

async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return sendError(res, { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }, 405); }
  try {
    const body = bodyOf(req);
    const inputs = Array.isArray(body.opportunities) ? body.opportunities : [body];
    if (!inputs.length || inputs.length > 50) return sendError(res, { code: 'VALIDATION_ERROR', message: 'Provide between 1 and 50 opportunities.' });
    const results = [];
    for (const input of inputs) results.push(await ingestFundingWatch(input));
    return sendData(res, { results, counts: results.reduce((out, item) => { const key = item.status || item.reason || 'unknown'; out[key] = (out[key] || 0) + 1; return out; }, {}) });
  } catch (error) { return sendError(res, error); }
}

export default withCommandAuth(handler);
