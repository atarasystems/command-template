import './_lib/google-env.js';
// api/send-email.js
// Sends email or saves as Gmail draft using OAuth refresh token.
// Required env vars: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
import { withCommandAuth } from './_lib/auth.js';

export const config = { runtime: 'nodejs' };

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function getAccessToken() {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Could not get access token: ' + JSON.stringify(data));
  return data.access_token;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// [Words to click](https://link) in a message becomes a short clickable link in the email.
const NAMED_LINK = /\[([^\]\n]{1,80})\]\((https?:\/\/[^\s)]+)\)/g;
export function plainTextOf(body) { return String(body || '').replace(NAMED_LINK, (_, label, url) => `${label}: ${url}`); }

export function textToHtml(body) {
  const named = [];
  const marked = String(body || '').replace(/\r\n?/g, '\n').replace(NAMED_LINK, (_, label, url) => { named.push({ label, url }); return `\u0000${named.length - 1}\u0000`; });
  const escaped = escapeHtml(marked);
  const linked = escaped.replace(/https?:\/\/[^\s<]+/g, (url) => {
    const href = url.replace(/&amp;/g, '&');
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
  const withNamed = linked.replace(/\u0000(\d+)\u0000/g, (_, i) => { const n = named[Number(i)]; return `<a href="${escapeHtml(n.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(n.label)}</a>`; });
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5;color:#202124;white-space:pre-wrap">${withNamed}</div>`;
}

function appendAlternativePart(mime, boundary, body) {
  mime += '--' + boundary + '\r\n';
  mime += 'Content-Type: text/plain; charset=UTF-8\r\n';
  mime += 'Content-Transfer-Encoding: 8bit\r\n\r\n';
  mime += plainTextOf(body) + '\r\n\r\n';
  mime += '--' + boundary + '\r\n';
  mime += 'Content-Type: text/html; charset=UTF-8\r\n';
  mime += 'Content-Transfer-Encoding: 8bit\r\n\r\n';
  mime += textToHtml(body) + '\r\n\r\n';
  mime += '--' + boundary + '--\r\n';
  return mime;
}

function buildRaw({ to, cc, subject, body, attachments, inReplyTo = null, references = null }) {
  const mixedBoundary = 'atara_mixed_' + Date.now();
  const altBoundary = 'atara_alt_' + Date.now();
  const toHeader  = Array.isArray(to) ? to.join(', ') : (to || '');
  const ccHeader  = Array.isArray(cc) ? cc.join(', ') : (cc || '');
  const hasAttach = attachments && attachments.length > 0;
  const textBody = String(body || '').replace(/\r\n?/g, '\n');

  let mime = '';
  mime += 'MIME-Version: 1.0\r\n';
  mime += 'From: me\r\n';
  mime += 'To: ' + toHeader + '\r\n';
  if (ccHeader) mime += 'Cc: ' + ccHeader + '\r\n';
  mime += 'Subject: ' + subject + '\r\n';
  if (inReplyTo) mime += 'In-Reply-To: ' + inReplyTo + '\r\n';
  if (references) mime += 'References: ' + references + '\r\n';

  if (hasAttach) {
    mime += 'Content-Type: multipart/mixed; boundary="' + mixedBoundary + '"\r\n\r\n';
    mime += '--' + mixedBoundary + '\r\n';
    mime += 'Content-Type: multipart/alternative; boundary="' + altBoundary + '"\r\n\r\n';
    mime = appendAlternativePart(mime, altBoundary, textBody);
    for (const att of attachments) {
      mime += '--' + mixedBoundary + '\r\n';
      mime += 'Content-Type: ' + att.type + '; name="' + att.name + '"\r\n';
      mime += 'Content-Disposition: attachment; filename="' + att.name + '"\r\n';
      mime += 'Content-Transfer-Encoding: base64\r\n\r\n';
      mime += att.data + '\r\n\r\n';
    }
    mime += '--' + mixedBoundary + '--';
  } else {
    mime += 'Content-Type: multipart/alternative; boundary="' + altBoundary + '"\r\n\r\n';
    mime = appendAlternativePart(mime, altBoundary, textBody);
  }

  return Buffer.from(mime)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function headerValue(headers, name) {
  const row = (headers || []).find(item => String(item?.name || '').toLowerCase() === String(name || '').toLowerCase());
  return row?.value || null;
}

function appendReference(existing, messageId) {
  const tokens = String(existing || '').split(/\s+/).filter(Boolean);
  if (messageId && !tokens.includes(messageId)) tokens.push(messageId);
  return tokens.join(' ') || null;
}

function replyContextFromMessage(message, requestedThreadId = null) {
  const messageId = headerValue(message?.payload?.headers, 'Message-ID');
  if (!messageId) throw new Error('Reply source is missing its RFC Message-ID header');
  return {
    threadId: message?.threadId || requestedThreadId || null,
    inReplyTo: messageId,
    references: appendReference(headerValue(message?.payload?.headers, 'References'), messageId),
  };
}

async function getLatestThreadReplyContext(accessToken, requestedThreadId) {
  const url = new URL(GMAIL_API + '/threads/' + encodeURIComponent(requestedThreadId));
  url.searchParams.set('format', 'metadata');
  url.searchParams.append('metadataHeaders', 'Message-ID');
  url.searchParams.append('metadataHeaders', 'References');
  const response = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data?.error?.message || 'Could not verify Gmail thread context');
  const messages = (data.messages || []).slice().sort((a, b) => Number(a?.internalDate || 0) - Number(b?.internalDate || 0));
  const latest = messages[messages.length - 1];
  if (!latest) throw new Error('Selected Gmail thread has no messages');
  return replyContextFromMessage(latest, data.id || requestedThreadId);
}

async function getReplyContext(accessToken, replyMessageId, requestedThreadId = null) {
  // For warm replies, use the exact incoming Gmail message when Command has it.
  if (replyMessageId) {
    const url = new URL(GMAIL_API + '/messages/' + encodeURIComponent(replyMessageId));
    url.searchParams.set('format', 'metadata');
    url.searchParams.append('metadataHeaders', 'Message-ID');
    url.searchParams.append('metadataHeaders', 'References');
    const response = await fetch(url, { headers: { Authorization: 'Bearer ' + accessToken } });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(data?.error?.message || 'Could not verify Gmail reply context');
    if (requestedThreadId && data.threadId && requestedThreadId !== data.threadId) {
      throw new Error('Reply source does not belong to the selected Gmail thread');
    }
    return replyContextFromMessage(data, requestedThreadId);
  }

  // Cold follow-ups often have no incoming message to reply to. In that case,
  // continue the existing thread by referencing its latest message (usually our
  // prior outbound email) instead of forcing the founder to open a nonexistent
  // incoming message first.
  if (requestedThreadId) return getLatestThreadReplyContext(accessToken, requestedThreadId);

  return { threadId: null, inReplyTo: null, references: null };
}

export async function sendGmailMessage({ to, cc, subject, body, attachments = [], saveAsDraft = false, threadId = null, replyMessageId = null }) {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
    const error = new Error('Gmail OAuth env vars not configured');
    error.code = 'GMAIL_NOT_CONFIGURED';
    throw error;
  }
  const accessToken = await getAccessToken();
  const replyContext = await getReplyContext(accessToken, replyMessageId, threadId);
  const raw = buildRaw({
    to,
    cc,
    subject: subject || '(no subject)',
    body: body || '',
    attachments,
    inReplyTo: replyContext.inReplyTo,
    references: replyContext.references,
  });
  const endpoint = saveAsDraft ? GMAIL_API + '/drafts' : GMAIL_API + '/messages/send';
  const message = replyContext.threadId ? { raw, threadId: replyContext.threadId } : { raw };
  const payload = saveAsDraft ? { message } : message;
  const gmailRes = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const gmailData = await gmailRes.json();
  if (gmailData.error) throw new Error(gmailData.error.message || 'Gmail error');
  return gmailData;
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
    return res.status(500).json({ ok: false, error: 'Gmail OAuth env vars not configured. Add GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN to Vercel.' });
  }

  try {
    const { to, cc, subject, body, attachments, saveAsDraft, threadId, replyMessageId } = req.body;

    if (!saveAsDraft && (!to || !to.length)) {
      return res.status(400).json({ ok: false, error: 'Recipient required' });
    }

    const gmailData = await sendGmailMessage({ to, cc, subject, body, attachments, saveAsDraft, threadId, replyMessageId });
    return res.status(200).json({ ok: true, id: gmailData.id, threadId: gmailData.threadId || null });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

export default withCommandAuth(handler);
