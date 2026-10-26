import { withCommandAuth } from '../_lib/auth.js';
import { findOrCreateLabel, getAccessToken, gmailConfigured, modifyMessageLabels, trashMessage, untrashMessage } from '../_lib/gmail.js';

const ACTIONS = new Set(['archive', 'cleanup', 'mark_read', 'mark_unread', 'trash', 'untrash', 'restore_inbox']);
const RESULT_MESSAGES = { archive: 'Archived in Gmail', cleanup: 'Moved to Command Cleanup', mark_read: 'Marked read', mark_unread: 'Marked unread', trash: 'Moved to Gmail Trash', untrash: 'Restored from Gmail Trash', restore_inbox: 'Restored to Inbox' };

export function actionPlan(action, cleanupLabelId = null) {
  if (action === 'archive') return { removeLabelIds: ['INBOX'] };
  if (action === 'cleanup') return { addLabelIds: [cleanupLabelId], removeLabelIds: ['INBOX'] };
  if (action === 'mark_read') return { removeLabelIds: ['UNREAD'] };
  if (action === 'mark_unread') return { addLabelIds: ['UNREAD'] };
  if (action === 'trash') return { operation: 'trash' };
  if (action === 'untrash') return { operation: 'untrash' };
  if (action === 'restore_inbox') return { operation: 'restore_inbox' };
  return null;
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: { message: 'Method not allowed' } });
  const { action, gmail_message_id: messageId, confirmed } = req.body || {};
  if (!messageId || typeof messageId !== 'string' || !messageId.trim()) return res.status(400).json({ ok: false, error: { message: 'gmail_message_id is required' } });
  if (!ACTIONS.has(action)) return res.status(400).json({ ok: false, error: { message: 'Unsupported Gmail action' } });
  if (action === 'trash' && confirmed !== true) return res.status(400).json({ ok: false, error: { message: 'Trash requires explicit confirmation' } });
  if (!gmailConfigured()) return res.status(500).json({ ok: false, error: { code: 'GMAIL_NOT_CONFIGURED', message: 'Gmail is not configured.' } });
  try {
    const token = await getAccessToken();
    const label = action === 'cleanup' ? await findOrCreateLabel(token) : null;
    const plan = actionPlan(action, label?.id);
    if (plan.operation === 'trash') await trashMessage(token, messageId.trim());
    else if (plan.operation === 'untrash') await untrashMessage(token, messageId.trim());
    else if (plan.operation === 'restore_inbox') { await untrashMessage(token, messageId.trim()); await modifyMessageLabels(token, messageId.trim(), { addLabelIds: ['INBOX'] }); }
    else await modifyMessageLabels(token, messageId.trim(), plan);
    return res.status(200).json({ ok: true, action, message: RESULT_MESSAGES[action] });
  } catch (error) { return res.status(502).json({ ok: false, error: { code: 'GMAIL_ACTION_FAILED', message: error.message } }); }
}

export default withCommandAuth(handler);
