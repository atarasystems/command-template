import { withCommandAuth } from '../_lib/auth.js';
import { gmailBody, gmailConfigured, getAccessToken } from '../_lib/gmail.js';
import { extractCalendarCandidates } from '../_lib/calendar-email.js';
import { verifyPendingEmailRead } from '../_lib/river-calendar-action.js';

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: { message: 'Method not allowed' } });
  const pending = verifyPendingEmailRead(req, req.body?.email_read_token);
  if (!pending) return res.status(400).json({ ok: false, error: { message: 'This email reading context has expired or is invalid.' } });
  if (!gmailConfigured()) return res.status(500).json({ ok: false, error: { code: 'GMAIL_NOT_CONFIGURED', message: 'Gmail is not configured.' } });
  try {
    const content = await gmailBody(await getAccessToken(), pending.message.message_id);
    const email = { sender: pending.message.sender || 'Unknown sender', subject: pending.message.subject || '(no subject)', received_at: pending.message.received_at || null };
    const calendarCandidates = extractCalendarCandidates({ subject: email.subject, body: content.body, received_at: email.received_at });
    return res.status(200).json({ ok: true, data: { status: 'ready', email, body: content.body, attachments: content.attachments || [], calendar_candidates: calendarCandidates } });
  } catch (error) {
    return res.status(502).json({ ok: false, error: { code: 'GMAIL_READ_FAILED', message: error.message } });
  }
}

export default withCommandAuth(handler);
