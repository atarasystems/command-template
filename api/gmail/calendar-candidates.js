import { withCommandAuth } from '../_lib/auth.js';
import { gmailBody, gmailConfigured, getAccessToken, searchMessages } from '../_lib/gmail.js';
import { eventOverlaps, extractCalendarCandidates } from '../_lib/calendar-email.js';
import { getGoogleAccessToken, listGoogleCalendarEvents } from '../_lib/google-calendar.js';
import { createPendingCalendarAction, createPendingEmailRead, createPendingSenderResolution, verifyPendingSenderResolution } from '../_lib/river-calendar-action.js';
import { envTimeZone } from '../_lib/founder-settings.js';

function cleanQuery(value) {
  return String(value || '').trim().replace(/[{}()<>]/g, '').slice(0, 160);
}

function cleanPhrase(value) {
  return cleanQuery(value).replace(/["']/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeSubject(value) {
  return cleanPhrase(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function subjectScore(query, subject) {
  const wanted = normalizeSubject(query);
  const found = normalizeSubject(subject);
  if (!wanted || !found) return 0;
  if (found.includes(wanted)) return 1;
  const tokens = wanted.split(' ').filter((token) => token.length > 1);
  const matched = tokens.filter((token) => found.includes(token)).length;
  return tokens.length ? matched / tokens.length : 0;
}

function subjectQueries(value) {
  const phrase = cleanPhrase(value);
  const tokens = normalizeSubject(phrase).split(' ').filter(Boolean).slice(0, 8);
  if (!phrase || !tokens.length) return [];
  const queries = [`subject:"${phrase}"`];
  if (tokens.length > 1) queries.push(tokens.map((token) => `subject:${token}`).join(' '));
  return queries;
}

function receivedDateQuery(value) {
  if (!/\blast week\b/i.test(String(value || ''))) return '';
  const now = new Date();
  const day = new Date(now.toLocaleString('en-US', { timeZone: envTimeZone() }));
  const end = new Date(day); end.setDate(end.getDate() - day.getDay());
  const start = new Date(end); start.setDate(start.getDate() - 7);
  const format = (date) => `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
  return `after:${format(start)} before:${format(end)}`;
}

function rankSubjectMessages(messages, subjectQuery) {
  if (!subjectQuery) return messages;
  return messages
    .map((message, index) => ({ message, score: subjectScore(subjectQuery, message.subject), index }))
    .filter(({ score }) => score >= 0.5)
    .sort((left, right) => right.score - left.score || new Date(right.message.received_at || 0) - new Date(left.message.received_at || 0) || left.index - right.index)
    .map(({ message }) => message);
}

async function searchEmailMessages(token, { senderQuery, subjectQuery, dateHint }) {
  const sender = cleanQuery(senderQuery);
  const subject = cleanPhrase(subjectQuery);
  const dateQuery = receivedDateQuery(dateHint);
  const queries = [];
  if (sender && subject) queries.push(`from:${sender} ${subjectQueries(subject)[0]}`);
  if (sender) queries.push(`from:${sender}`);
  if (subject) subjectQueries(subject).forEach((query) => queries.push(query));
  const uniqueQueries = [...new Set(queries)].map((query) => [query, dateQuery].filter(Boolean).join(' '));
  const found = new Map();
  for (const query of uniqueQueries.slice(0, 4)) {
    const results = await searchMessages(token, query, subject ? 25 : 10);
    for (const message of results) if (message.message_id && !found.has(message.message_id)) found.set(message.message_id, message);
    if (found.size && (!subject || rankSubjectMessages([...found.values()], subject).length)) break;
  }
  return rankSubjectMessages([...found.values()], subject);
}

function normalizeSenderName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function editDistance(left, right) {
  const a = String(left || ''), b = String(right || '');
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j];
      row[j] = a[i - 1] === b[j - 1] ? diagonal : Math.min(row[j] + 1, row[j - 1] + 1, diagonal + 1);
      diagonal = above;
    }
  }
  return row[b.length];
}

export function senderSimilarity(requested, candidate) {
  const wanted = normalizeSenderName(requested).split(' ').filter(Boolean);
  const found = normalizeSenderName(candidate).split(' ').filter(Boolean);
  if (wanted.length < 2 || found.length < 2) return 0;
  const wantedLast = wanted.at(-1), foundLast = found.at(-1);
  const wantedFirst = wanted[0], foundFirst = found[0];
  const lastDistance = editDistance(wantedLast, foundLast);
  const firstDistance = editDistance(wantedFirst, foundFirst);
  const lastExact = wantedLast === foundLast;
  const firstSimilar = firstDistance <= 1 || (wantedFirst.length >= 6 && foundFirst.length >= 6 && firstDistance <= 2);
  const firstPrefix = wantedFirst.startsWith(foundFirst) || foundFirst.startsWith(wantedFirst);
  if (lastExact && (firstSimilar || (firstPrefix && Math.min(wantedFirst.length, foundFirst.length) >= 3))) return 1 - ((firstDistance / Math.max(wantedFirst.length, foundFirst.length)) * 0.25);
  if (lastDistance <= 2 && firstPrefix && Math.min(wantedFirst.length, foundFirst.length) >= 3) return 0.82;
  const fullWanted = wanted.join(''), fullFound = found.join('');
  const fullDistance = editDistance(fullWanted, fullFound);
  return fullDistance <= 2 && fullDistance / Math.max(fullWanted.length, fullFound.length) <= 0.2 ? 0.8 : 0;
}

export function senderAlternatives(requested, messages) {
  const byName = new Map();
  for (const message of messages || []) {
    const name = message.sender?.name || message.sender?.email || '';
    const score = senderSimilarity(requested, name);
    if (score < 0.8) continue;
    const key = normalizeSenderName(name);
    if (!key || (byName.get(key)?.score || 0) >= score) continue;
    byName.set(key, { sender: name, score });
  }
  return [...byName.values()].sort((left, right) => right.score - left.score).slice(0, 3);
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: { message: 'Method not allowed' } });
  const body = req.body || {};
  const senderQuery = cleanQuery(body.sender_query);
  const subjectQuery = cleanPhrase(body.subject_query);
  if (!senderQuery && !subjectQuery) return res.status(400).json({ ok: false, error: { message: 'sender_query or subject_query is required' } });
  if (!gmailConfigured()) return res.status(500).json({ ok: false, error: { code: 'GMAIL_NOT_CONFIGURED', message: 'Gmail is not configured.' } });
  try {
    const token = await getAccessToken();
    const senderResolution = body.sender_resolution_token ? verifyPendingSenderResolution(req, body.sender_resolution_token) : null;
    const selectedSenderIndex = Number.isInteger(body.sender_candidate_index) ? body.sender_candidate_index : -1;
    if (body.sender_resolution_token && (!senderResolution || selectedSenderIndex < 0 || selectedSenderIndex >= senderResolution.candidates.length)) {
      return res.status(400).json({ ok: false, error: { message: 'The sender confirmation has expired or is invalid.' } });
    }
    const resolvedSenderQuery = senderResolution && selectedSenderIndex >= 0 && selectedSenderIndex < senderResolution.candidates.length
      ? cleanQuery(senderResolution.candidates[selectedSenderIndex].sender)
      : '';
    const lookupQuery = resolvedSenderQuery || senderQuery;
    let resolvedMessages = await searchEmailMessages(token, { senderQuery: lookupQuery, subjectQuery, dateHint: body.date_hint });
    if (!resolvedMessages.length && !senderResolution && !senderQuery.includes('@')) {
      const nameParts = normalizeSenderName(senderQuery).split(' ').filter(Boolean);
      const surname = nameParts.at(-1);
      if (surname && surname !== nameParts[0]) {
        const fallbackMessages = await searchEmailMessages(token, { senderQuery: surname, subjectQuery, dateHint: body.date_hint });
        const alternatives = senderAlternatives(senderQuery, fallbackMessages);
        if (alternatives.length) {
          const senderCandidates = alternatives.map(({ sender }) => ({ sender }));
          return res.status(200).json({ ok: true, data: { status: alternatives.length === 1 ? 'confirm_sender' : 'choose_sender', messages: [], sender_candidates: senderCandidates, sender_resolution_token: createPendingSenderResolution(req, senderQuery, senderCandidates), candidates: [] } });
        }
      }
    }
    if (!resolvedMessages.length) return res.status(200).json({ ok: true, data: { status: 'no_match', messages: [], candidates: [] } });
    const choices = resolvedMessages.slice(0, 3).map((message) => ({ subject: message.subject || '(no subject)', sender: message.sender?.name || message.sender?.email || 'Unknown sender', received_at: message.received_at }));
    const choiceIndex = Number.isInteger(body.choice_index) ? body.choice_index : -1;
    const selected = body.latest === true || (subjectQuery && resolvedMessages.length === 1)
      ? resolvedMessages[0]
      : (choiceIndex >= 0 && choiceIndex < resolvedMessages.length ? resolvedMessages[choiceIndex] : null);
    if (!selected) return res.status(200).json({ ok: true, data: { status: 'choose_email', messages: choices, candidates: [] } });
    const content = await gmailBody(token, selected.message_id);
    const emailReadMessage = { message_id: selected.message_id, thread_id: selected.thread_id, sender: selected.sender?.name || selected.sender?.email || 'Unknown sender', subject: selected.subject || '(no subject)', received_at: selected.received_at || null };
    const emailReadToken = createPendingEmailRead(req, emailReadMessage);
    const emailRead = { sender: emailReadMessage.sender, subject: emailReadMessage.subject, received_at: emailReadMessage.received_at };
    const candidates = extractCalendarCandidates({ subject: selected.subject, body: content.body, received_at: selected.received_at }).map((candidate) => ({ ...candidate, source_sender: selected.sender?.name || selected.sender?.email || 'Unknown sender' }));
    if (!candidates.length) return res.status(200).json({ ok: true, data: { status: 'no_dates', messages: choices, email_read: emailRead, email_read_token: emailReadToken, candidates: [] } });
    let calendarToken = null; try { calendarToken = await getGoogleAccessToken(); } catch (_) {}
    const enriched = [];
    for (const candidate of candidates) {
      let duplicate = false;
      if (calendarToken) { try { const next = new Date(`${candidate.date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1); const existing = await listGoogleCalendarEvents(calendarToken, `${candidate.date}T00:00:00-04:00`, `${next.toISOString().slice(0, 10)}T00:00:00-04:00`); duplicate = existing.some((event) => eventOverlaps(candidate, event)); } catch (_) { duplicate = false; } }
      enriched.push({ ...candidate, duplicate });
    }
    return res.status(200).json({ ok: true, data: { status: 'ready', messages: choices, email_read: emailRead, email_read_token: emailReadToken, candidates: enriched, action_token: createPendingCalendarAction(req, enriched) } });
  } catch (error) {
    return res.status(502).json({ ok: false, error: { code: 'GMAIL_CALENDAR_PREP_FAILED', message: error.message } });
  }
}

export default withCommandAuth(handler);
