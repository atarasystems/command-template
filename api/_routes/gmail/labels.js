import { withCommandAuth } from '../_lib/auth.js';
import { ensureRelationshipLabels, getAccessToken, gmailConfigured, listLabels, modifyThreadLabels, RELATIONSHIP_GMAIL_LABELS } from '../_lib/gmail.js';

async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ ok: false, error: { message: 'Method not allowed' } });
  if (!gmailConfigured()) return res.status(500).json({ ok: false, error: { code: 'GMAIL_NOT_CONFIGURED', message: 'Gmail is not configured. Add the existing Gmail OAuth configuration before managing labels.' } });
  try {
    const token = await getAccessToken();
    if (req.method === 'GET') {
      const labels = await listLabels(token);
      return res.status(200).json({ ok: true, data: { required: RELATIONSHIP_GMAIL_LABELS, labels: labels.filter((label) => RELATIONSHIP_GMAIL_LABELS.includes(label.name)) } });
    }
    const body = req.body || {};
    if (body.action === 'ensure') {
      const labels = await ensureRelationshipLabels(token);
      return res.status(200).json({ ok: true, data: { required: RELATIONSHIP_GMAIL_LABELS, labels } });
    }
    if (body.action === 'apply') {
      const threadId = String(body.thread_id || '').trim();
      const labelName = String(body.label_name || '').trim();
      if (!threadId) return res.status(400).json({ ok: false, error: { message: 'thread_id is required' } });
      if (!RELATIONSHIP_GMAIL_LABELS.includes(labelName)) return res.status(400).json({ ok: false, error: { message: 'Choose one of the approved relationship labels' } });
      const labels = await listLabels(token);
      const label = labels.find((item) => item.name === labelName);
      if (!label) return res.status(409).json({ ok: false, error: { code: 'LABEL_NOT_READY', message: 'This label is not set up yet. Use Set up Gmail labels first.' } });
      await modifyThreadLabels(token, threadId, { addLabelIds: [label.id] });
      return res.status(200).json({ ok: true, data: { thread_id: threadId, label: labelName, message: 'Gmail thread labeled' } });
    }
    return res.status(400).json({ ok: false, error: { message: 'action must be ensure or apply' } });
  } catch (error) {
    return res.status(502).json({ ok: false, error: { code: 'GMAIL_LABEL_ACTION_FAILED', message: error.message } });
  }
}

export default withCommandAuth(handler);
