import './google-env.js';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
export const RELATIONSHIP_GMAIL_LABELS = [
  'Command / Prospecting',
  'Command / Networking',
  'Command / Clients',
  'Command / Partners',
  'Command / Programs + Grants',
];
export const WEEKLY_REVIEW_LABEL = 'Command / Weekly Review';

export function gmailConfigured() {
  return Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);
}

export async function getAccessToken() {
  const response = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.GMAIL_CLIENT_ID, client_secret: process.env.GMAIL_CLIENT_SECRET, refresh_token: process.env.GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token' }) });
  const data = await response.json();
  if (!data.access_token) throw new Error('Could not get Gmail access token');
  return data.access_token;
}

export const AUTOMATED_EMAIL = /^(noreply|no-reply|donotreply|do-not-reply|notifications?|mailer|bounce|postmaster|info|support|help|contact|team|admin|billing|newsletter|updates|alerts|news|unsubscribe)@/i;

export function parseFrom(header = '') {
  const match = header.match(/^"?([^"<]*?)"?\s*<([^>]+)>/);
  if (match) return { name: match[1].trim(), email: match[2].trim().toLowerCase() };
  return { name: '', email: header.trim().toLowerCase() };
}

export function isMeaningfulSender(email) {
  return Boolean(email && email.includes('@') && !AUTOMATED_EMAIL.test(email));
}

export async function gmailMetadata(accessToken, messageId) {
  const response = await fetch(`${GMAIL_API}/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || 'Could not read Gmail metadata');
  const headers = Object.fromEntries((data.payload?.headers || []).map((header) => [header.name.toLowerCase(), header.value]));
  return { message_id: data.id, thread_id: data.threadId || null, sender: parseFrom(headers.from || ''), subject: headers.subject || '', snippet: data.snippet || '', received_at: headers.date ? new Date(headers.date).toISOString() : (data.internalDate ? new Date(Number(data.internalDate)).toISOString() : null), label_ids: data.labelIds || [] };
}

export async function gmailThreadHasReply(accessToken, threadId, afterTimestamp) {
  if (!threadId || !afterTimestamp) return false;
  const after = new Date(afterTimestamp).getTime();
  if (Number.isNaN(after)) return false;
  const response = await fetch(`${GMAIL_API}/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Date`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || 'Could not inspect Gmail thread');
  return (data.messages || []).some((message) => {
    const occurredAt = message.internalDate ? Number(message.internalDate) : null;
    if (!occurredAt || occurredAt <= after) return false;
    const labels = new Set(message.labelIds || []);
    if (labels.has('SENT') || labels.has('DRAFT') || labels.has('TRASH')) return false;
    return true;
  });
}

export async function listLabels(accessToken) {
  const response = await fetch(`${GMAIL_API}/labels`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || 'Could not list Gmail labels');
  return data.labels || [];
}

export async function findOrCreateLabel(accessToken, name = process.env.COMMAND_GMAIL_CLEANUP_LABEL || 'Command Cleanup') {
  const existing = (await listLabels(accessToken)).find((label) => label.name === name);
  if (existing) return existing;
  const response = await fetch(`${GMAIL_API}/labels`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }) });
  const data = await response.json();
  if (response.ok && !data.error) return data;
  const concurrent = (await listLabels(accessToken)).find((label) => label.name === name);
  if (concurrent) return concurrent;
  throw new Error(data.error?.message || 'Could not create Gmail label');
}

export async function modifyMessageLabels(accessToken, messageId, { addLabelIds = [], removeLabelIds = [] } = {}) {
  const response = await fetch(`${GMAIL_API}/messages/${encodeURIComponent(messageId)}/modify`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ addLabelIds, removeLabelIds }) });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || 'Could not update Gmail message');
  return data;
}

export async function modifyThreadLabels(accessToken, threadId, { addLabelIds = [], removeLabelIds = [] } = {}) {
  const response = await fetch(`${GMAIL_API}/threads/${encodeURIComponent(threadId)}/modify`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ addLabelIds, removeLabelIds }) });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || 'Could not update Gmail thread labels');
  return data;
}

export async function ensureRelationshipLabels(accessToken) {
  const existing = await listLabels(accessToken);
  const byName = new Map(existing.map((label) => [label.name, label]));
  const labels = [];
  for (const name of RELATIONSHIP_GMAIL_LABELS) {
    const label = byName.get(name) || await findOrCreateLabel(accessToken, name);
    byName.set(name, label);
    labels.push(label);
  }
  return labels;
}

async function messageStateAction(accessToken, messageId, action) {
  const response = await fetch(`${GMAIL_API}/messages/${encodeURIComponent(messageId)}/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || `Could not ${action} Gmail message`);
  return data;
}

export function trashMessage(accessToken, messageId) { return messageStateAction(accessToken, messageId, 'trash'); }
export function untrashMessage(accessToken, messageId) { return messageStateAction(accessToken, messageId, 'untrash'); }

export async function listInbox(accessToken, days = 30) {
  const after = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);
  const response = await fetch(`${GMAIL_API}/messages?maxResults=100&q=in:inbox+after:${after}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || 'Could not list Gmail messages');
  return data.messages || [];
}

export async function searchMessages(accessToken, query, maxResults = 10) {
  const params = new URLSearchParams({ q: String(query || '').trim(), maxResults: String(Math.min(Math.max(Number(maxResults) || 10, 1), 100)) });
  const response = await fetch(`${GMAIL_API}/messages?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || 'Could not search Gmail messages');
  const messages = data.messages || [];
  const metadata = [];
  for (const message of messages) {
    try { metadata.push(await gmailMetadata(accessToken, message.id)); } catch (_) { /* omit one unreadable message */ }
  }
  return metadata;
}

export async function listMessagesByLabel(accessToken, labelId) {
  const response = await fetch(`${GMAIL_API}/messages?labelIds=${encodeURIComponent(labelId)}&maxResults=100`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || 'Could not list Gmail label messages');
  const messages = data.messages || [];
  const metadata = [];
  for (const message of messages) {
    try { metadata.push(await gmailMetadata(accessToken, message.id)); } catch (_) { /* keep one stale message from hiding the rest */ }
  }
  return metadata;
}

export async function gmailBody(accessToken, messageId) {
  const response = await fetch(`${GMAIL_API}/messages/${encodeURIComponent(messageId)}?format=full`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || 'Could not read Gmail message');
  function decode(part) { try { return Buffer.from((part || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'); } catch (_) { return ''; } }
  function htmlText(value) {
    return String(value || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>|<\/div>|<\/li>|<\/tr>/gi, '\n')
      .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
      .replace(/<[^>]+>/g, '').replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
      .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/g, "'");
  }
  function collect(part, output, attachments) {
    if (!part) return;
    if (part.filename) attachments.push({ filename: part.filename, mime_type: part.mimeType || null });
    const value = part.body?.data ? decode(part.body.data) : '';
    if (value && part.mimeType === 'text/plain') output.plain.push(value);
    if (value && part.mimeType === 'text/html') output.html.push(value);
    (part.parts || []).forEach((child) => collect(child, output, attachments));
  }
  function removeRepeatedQuotedLines(value) {
    const lines = String(value || '').split(/\r?\n/);
    const current = new Set(lines.filter((line) => !/^\s*>/.test(line)).map((line) => line.trim()).filter(Boolean));
    return lines.filter((line) => {
      if (!/^\s*>/.test(line)) return true;
      const unquoted = line.replace(/^\s*>+\s?/, '').trim();
      return !unquoted || !current.has(unquoted);
    }).join('\n');
  }
  const output = { plain: [], html: [] }, attachments = [];
  collect(data.payload, output, attachments);
  const body = removeRepeatedQuotedLines(output.plain.join('\n') || output.html.map(htmlText).join('\n')).replace(/\n{3,}/g, '\n\n').trim().slice(0, 50000);
  return { message_id: data.id, thread_id: data.threadId || null, body, attachments };
}
