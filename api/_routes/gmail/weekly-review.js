import { withCommandAuth } from '../_lib/auth.js';
import { findOrCreateLabel, getAccessToken, gmailConfigured, listLabels, listMessagesByLabel, modifyMessageLabels, WEEKLY_REVIEW_LABEL } from '../_lib/gmail.js';

function messageId(body) { return String(body?.gmail_message_id || '').trim(); }

async function weeklyLabel(token, create = false) {
  const labels = await listLabels(token);
  const existing = labels.find((label) => label.name === WEEKLY_REVIEW_LABEL);
  return existing || (create ? findOrCreateLabel(token, WEEKLY_REVIEW_LABEL) : null);
}

async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ ok: false, error: { message: 'Method not allowed' } });
  const body = req.body || {}, action = String(body.action || '');
  if (req.method === 'POST' && !['ensure_label', 'file', 'restore', 'reclassify'].includes(action)) return res.status(400).json({ ok: false, error: { message: 'action must be ensure_label, file, restore, or reclassify' } });
  if (req.method === 'POST' && action !== 'ensure_label' && !messageId(body)) return res.status(400).json({ ok: false, error: { message: 'gmail_message_id is required' } });
  if (!gmailConfigured()) return res.status(500).json({ ok: false, error: { code: 'GMAIL_NOT_CONFIGURED', message: 'Gmail is not configured.' } });
  try {
    const token = await getAccessToken();
    if (req.method === 'GET') {
      const label = await weeklyLabel(token);
      return res.status(200).json({ ok: true, data: { label: label ? { id: label.id, name: label.name } : null, messages: label ? await listMessagesByLabel(token, label.id) : [] } });
    }
    if (action === 'ensure_label') {
      const label = await weeklyLabel(token, true);
      return res.status(200).json({ ok: true, data: { label: { id: label.id, name: label.name } } });
    }
    const id = messageId(body);
    const label = await weeklyLabel(token, action === 'file');
    if (!label) return res.status(409).json({ ok: false, error: { code: 'WEEKLY_REVIEW_LABEL_NOT_READY', message: 'Weekly Review label has not been created.' } });
    if (action === 'file') {
      await modifyMessageLabels(token, id, { addLabelIds: [label.id], removeLabelIds: ['INBOX'] });
      return res.status(200).json({ ok: true, data: { gmail_message_id: id, action, message: 'Filed in Weekly Review' } });
    }
    if (action === 'restore' || action === 'reclassify') {
      await modifyMessageLabels(token, id, { addLabelIds: ['INBOX'], removeLabelIds: [label.id] });
      return res.status(200).json({ ok: true, data: { gmail_message_id: id, action, message: action === 'restore' ? 'Restored to Inbox' : 'Restored to Inbox for reclassification' } });
    }
  } catch (error) { return res.status(502).json({ ok: false, error: { code: 'WEEKLY_REVIEW_FAILED', message: error.message } }); }
}

export default withCommandAuth(handler);
