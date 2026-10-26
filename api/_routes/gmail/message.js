import { withCommandAuth } from '../_lib/auth.js';
import { getAccessToken, gmailBody, gmailConfigured } from '../_lib/gmail.js';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: { message: 'Method not allowed' } });
  if (!gmailConfigured()) return res.status(500).json({ ok: false, error: { code: 'GMAIL_NOT_CONFIGURED', message: 'Gmail is not configured.' } });
  if (!req.query?.id) return res.status(400).json({ ok: false, error: { message: 'id is required' } });
  try { return res.status(200).json({ ok: true, data: await gmailBody(await getAccessToken(), req.query.id) }); } catch (error) { return res.status(500).json({ ok: false, error: { message: error.message } }); }
}
export default withCommandAuth(handler);
