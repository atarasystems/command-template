import { withCommandAuth } from '../_lib/auth.js';
import { getRow } from '../_lib/records.js';
import { gmailBody, gmailConfigured, gmailMetadata, getAccessToken } from '../_lib/gmail.js';

function trimQuotedReply(value = '') {
  const text = String(value || '').replace(/\r\n?/g, '\n').trim();
  const markers = [
    /\nOn .+?wrote:\s*\n/i,
    /\n-{2,}\s*Original Message\s*-{2,}\s*\n/i,
    /\nFrom:\s.+\nSent:\s.+\nTo:\s.+\nSubject:\s.+\n/i,
  ];
  let cut = text.length;
  for (const marker of markers) {
    const match = marker.exec(text);
    if (match && match.index < cut) cut = match.index;
  }
  return text.slice(0, cut).trim().slice(0, 12000);
}

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: { message: 'Method not allowed' } });
  const draftId = String(req.query.draft_id || '').trim();
  if (!draftId) return res.status(400).json({ ok: false, error: { message: 'draft_id is required' } });
  if (!gmailConfigured()) return res.status(500).json({ ok: false, error: { message: 'Gmail is not configured.' } });

  try {
    const draft = await getRow('crm_email_drafts', draftId);
    if (!draft.gmail_thread_id || !draft.gmail_message_id) {
      return res.status(200).json({ ok: true, data: { replying: false, verified: false } });
    }

    const accessToken = await getAccessToken();
    const [metadata, content] = await Promise.all([
      gmailMetadata(accessToken, draft.gmail_message_id),
      gmailBody(accessToken, draft.gmail_message_id),
    ]);

    const sourceThreadId = metadata.thread_id || content.thread_id || null;
    if (!sourceThreadId || sourceThreadId !== draft.gmail_thread_id) {
      return res.status(409).json({ ok: false, error: { message: 'The source email no longer matches the Gmail thread saved on this draft.' } });
    }

    return res.status(200).json({
      ok: true,
      data: {
        replying: true,
        verified: true,
        source: {
          sender_name: metadata.sender?.name || '',
          sender_email: metadata.sender?.email || '',
          subject: metadata.subject || '(no subject)',
          received_at: metadata.received_at || null,
          body: trimQuotedReply(content.body || metadata.snippet || ''),
        },
      },
    });
  } catch (error) {
    return res.status(502).json({ ok: false, error: { message: error.message || 'Could not verify Gmail reply context.' } });
  }
}

export default withCommandAuth(handler);
