// Email assistant: reads new inbox mail, sorts it, drafts replies, and turns to-dos into tasks.
// It never sends. Every reply waits for the founder.
import { aiText } from './ai.js';
import { GMAIL_API, getAccessToken, gmailMetadata, gmailBody, parseFrom } from './gmail.js';
import { easternDate, noDashes, parseJson } from './updates.js';
import { sendGmailMessage } from '../send-email.js';
import { headsUpFromEmail } from './heads-up.js';
import { DEFAULT_SETTINGS, founderSettings, firstName, companyName, brandList, envTimeZone, voiceText } from './founder-settings.js';

export const TRIAGE_KINDS = ['reply', 'todo', 'fyi', 'skip'];
const WORK_CATEGORIES = ['general', 'sales', 'networking', 'client', 'grant', 'content', 'audit', 'product', 'admin'];
const SKIP_LABELS = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'SPAM', 'TRASH', 'SENT', 'DRAFT'];
export const RUN_LIMIT = 25;

export const ITEM_TYPES = ['reply', 'todo', 'event', 'prepare', 'optional', 'missed', 'info'];

function who(settings) {
  const f = settings?.founder || {};
  const brands = brandList(settings).map((b) => b.name).filter(Boolean);
  const role = [f.title || 'founder', settings?.company?.name ? 'of ' + settings.company.name : ''].filter(Boolean).join(' ');
  return (f.name || 'the founder') + ', ' + role + (settings?.company?.one_liner ? ' (' + settings.company.one_liner + ')' : '') + (brands.length ? ', with ' + brands.join(', ') : '');
}

export function triagePrompt(today, settings = DEFAULT_SETTINGS) {
  const name = firstName(settings);
  return [
    'You sort email for ' + who(settings) + '. Today is ' + today + ' (' + envTimeZone() + ').',
    'Read the WHOLE email, including the bottom. One email often holds several separate things. List every one as its own item.',
    'Item types:',
    '- reply: someone is waiting on ' + name + ' to write back.',
    '- todo: something ' + name + ' has to do (submit, sign, pay, register, upload, prepare, apply).',
    '- event: something ' + name + ' is expected to attend, with its date, time and place. Put arrival time, address, parking and what to bring in details.',
    '- optional: an invitation or offer ' + name + ' can choose to take (an RSVP, a call offer, an extra event).',
    '- missed: a deadline or date that is already before today. Say what closed and when.',
    '- info: a fact worth keeping with nothing to do.',
    'Then pick the email kind: reply if any item is reply; else todo if any item is todo or event; else fyi if anything is worth knowing; else skip (newsletters, marketing, automated notices).',
    'Return only JSON:',
    '{"kind": "reply|todo|fyi|skip", "summary": "one plain sentence on what the email is", "heads_up": "", "priority": "now|soon|normal", "category": "' + WORK_CATEGORIES.join('|') + '",',
    ' "items": [{"type": "reply|todo|event|prepare|optional|missed|info", "title": "short plain action or fact", "date": "YYYY-MM-DD or empty", "time": "HH:MM 24-hour or empty", "end_time": "HH:MM or empty", "place": "address or empty", "details": "the specifics ' + name + ' needs: times, address, parking, cost, links named in words, what to bring"}]}',
    'Use the year that fits today. A date before today is missed, not todo. priority now: something is due or happening within 2 days. soon: within a week.',
    'Use plain words.' + (settings?.voice?.no_dashes ? ' Never use em dashes or en dashes.' : ''),
  ].join('\n');
}

export function replyPrompt(settings = DEFAULT_SETTINGS) {
  const name = firstName(settings);
  const signoff = settings?.founder?.signoff || name;
  return [
    'You write email replies for ' + who(settings) + '. Write the reply ' + name + ' would send.',
    voiceText(settings),
    'Short paragraphs. Say what is true and what happens next. No filler, no fake familiarity.',
    'Never invent facts, dates, prices, commitments, attachments, or past conversations.',
    'When the reply needs something only ' + name + ' knows (a date that works, a price, a yes or no), write the sentence with a clear placeholder in square brackets, such as [day and time that works].',
    'Sign off with "' + signoff + '". Do not repeat the subject line in the body.',
    'Return only JSON: {"subject": "Re: ...", "body": "the reply"}',
  ].join('\n');
}

function clip(text, max) { const s = String(text || ''); return s.length > max ? s.slice(0, max) + '\n[cut]' : s; }

export function emailForAi(meta, body) {
  return `FROM: ${meta.sender?.name || ''} <${meta.sender?.email || ''}>\nSUBJECT: ${meta.subject || ''}\nRECEIVED: ${meta.received_at || ''}\n\n${clip(body || meta.snippet, 6000)}`;
}

export function cleanItems(list, today = easternDate()) {
  return (Array.isArray(list) ? list : []).slice(0, 12).map((raw) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(raw?.date || '')) ? raw.date : null;
    const hm = (v) => (/^\d{1,2}:\d{2}$/.test(String(v || '')) ? String(v).padStart(5, '0') : null);
    let type = ITEM_TYPES.includes(raw?.type) ? raw.type : 'info';
    // Anything dated before today can no longer be done.
    if (date && date < today && ['todo', 'event', 'prepare', 'optional'].includes(type)) type = 'missed';
    return { type, title: noDashes(String(raw?.title || '')).slice(0, 200), date, time: hm(raw?.time), end_time: hm(raw?.end_time), place: noDashes(String(raw?.place || '')).slice(0, 200), details: noDashes(String(raw?.details || '')).slice(0, 1200), status: 'open' };
  }).filter((item) => item.title);
}

export function cleanTriage(raw, today = easternDate()) {
  const items = cleanItems(raw?.items, today);
  const actionable = items.filter((i) => ['reply', 'todo', 'event', 'prepare'].includes(i.type));
  let kind = TRIAGE_KINDS.includes(raw?.kind) ? raw.kind : 'fyi';
  if (items.some((i) => i.type === 'reply')) kind = 'reply';
  else if (kind !== 'skip' && actionable.length) kind = 'todo';
  else if (kind === 'reply' || kind === 'todo') kind = items.length ? 'fyi' : kind;
  const first = actionable.filter((i) => i.date).sort((a, b) => a.date.localeCompare(b.date))[0] || actionable[0] || null;
  return {
    kind,
    summary: noDashes(String(raw?.summary || '')).slice(0, 400),
    ask: noDashes(String(raw?.ask || first?.title || '')).slice(0, 300),
    due_date: first?.date || (/^\d{4}-\d{2}-\d{2}$/.test(String(raw?.due_date || '')) ? raw.due_date : null),
    priority: ['now', 'soon', 'normal'].includes(raw?.priority) ? raw.priority : 'normal',
    category: WORK_CATEGORIES.includes(raw?.category) ? raw.category : 'general',
    heads_up: noDashes(String(raw?.heads_up || '')).slice(0, 600) || null,
    items,
  };
}

// Notices from LinkedIn and similar platforms are answered on that platform, never by email.
const PLATFORM_SENDER = /@(?:[\w-]+\.)*(?:linkedin\.com|facebookmail\.com|skool\.com|slack\.com|circle\.so|mighty(?:networks)?\.com|discord\.com|x\.com|twitter\.com|instagram\.com)$/i;
export function platformOf(meta) {
  const email = String(meta?.sender?.email || '');
  if (!PLATFORM_SENDER.test(email) && !/\bvia (?:LinkedIn|Skool|Slack)\b/i.test(meta?.sender?.name || '')) return null;
  const m = email.match(/(linkedin|facebookmail|skool|slack|circle|mighty|discord|instagram|twitter|x)\./i) || String(meta?.sender?.name || '').match(/via (\w+)/i);
  const name = (m ? m[1] : 'the platform').toLowerCase();
  return { linkedin: 'LinkedIn', facebookmail: 'Facebook', skool: 'Skool', slack: 'Slack', circle: 'Circle', mighty: 'Mighty Networks', discord: 'Discord', instagram: 'Instagram', twitter: 'X', x: 'X' }[name] || name;
}
export function noEmailReplies(triage, platform) {
  if (!platform) return triage;
  const items = (triage.items || []).map((i) => (i.type === 'reply' ? { ...i, type: 'todo', title: /^reply/i.test(i.title) && /on /i.test(i.title) ? i.title : `Reply on ${platform}: ${i.title.replace(/^reply to\s*/i, '')}` } : i));
  return { ...triage, items, kind: triage.kind === 'reply' ? 'todo' : triage.kind };
}

export async function triageEmail(meta, body, { today = easternDate(), fetchImpl, settings = DEFAULT_SETTINGS } = {}) {
  const text = await aiText({ system: triagePrompt(today, settings), user: emailForAi(meta, body), tier: 'fast', maxTokens: 1500, temperature: 0.1 }, { fetchImpl });
  return cleanTriage(parseJson(text), today);
}

export async function draftReply(meta, body, triage, { fetchImpl, settings = DEFAULT_SETTINGS } = {}) {
  const replyItem = (triage.items || []).find((i) => i.type === 'reply');
  const user = `${emailForAi(meta, body)}\n\nWHAT THE REPLY IS FOR: ${replyItem?.title || triage.ask || triage.summary}`;
  const out = parseJson(await aiText({ system: replyPrompt(settings), user, tier: 'write', maxTokens: 900, temperature: 0.4 }, { fetchImpl }));
  const subject = String(out?.subject || '').trim() || (/^re:/i.test(meta.subject || '') ? meta.subject : `Re: ${meta.subject || ''}`);
  return { subject: noDashes(subject).slice(0, 300), body: noDashes(String(out?.body || '').trim()) };
}

async function gmailJson(token, path, init = {}) {
  const response = await fetch(`${GMAIL_API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } });
  const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok || data.error) throw new Error(data.error?.message || `Gmail returned ${response.status}`);
  return data;
}

export async function listInboxIds(token, days) {
  const after = Math.floor((Date.now() - days * 86400000) / 1000);
  const data = await gmailJson(token, `/messages?maxResults=100&q=${encodeURIComponent(`in:inbox after:${after} -category:promotions -category:social`)}`);
  return (data.messages || []).map((m) => m.id);
}

// Did the founder already write back in this thread after this email arrived?
export async function repliedInThread(token, threadId, afterIso) {
  if (!threadId || !afterIso) return false;
  const data = await gmailJson(token, `/threads/${encodeURIComponent(threadId)}?format=minimal`);
  const after = Date.parse(afterIso);
  return (data.messages || []).some((m) => (m.labelIds || []).includes('SENT') && Number(m.internalDate || 0) > after);
}

async function mapLimit(items, limit, worker) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) { const idx = i++; out[idx] = await worker(items[idx]); } }));
  return out;
}

function itemTitle(meta, item) {
  const who = meta.sender?.name || meta.sender?.email || '';
  const when = item.time ? ` at ${item.time}` : '';
  return noDashes(item.type === 'reply' ? `Reply to ${who}: ${item.title}` : `${item.title}${item.type === 'event' ? when : ''}`).slice(0, 240);
}

// Each reply and to-do in an email becomes its own task with its own date.
// Events (meetings, webinars, office hours) go to Heads up on Today instead, so Work only holds things to do.
export async function upsertWork(db, meta, triage, settings = DEFAULT_SETTINGS) {
  const ids = [];
  const items = (triage.items || []).map((item, n) => ({ item, n })).filter(({ item }) => ['reply', 'todo', 'prepare'].includes(item.type) && item.status !== 'done');
  for (const { item, n } of items) {
    const sourceId = `${meta.message_id}#${n}`;
    const existing = await db.from('work_items').select('id,status').eq('source_type', 'gmail').eq('source_id', sourceId).limit(1);
    if (existing.error) throw existing.error;
    const due = item.date ? (item.time ? new Date(`${item.date}T${item.time}:00-04:00`).toISOString() : `${item.date}T21:00:00Z`) : null;
    const fields = {
      title: itemTitle(meta, item), category: triage.category,
      priority: triage.priority === 'now' ? 'now' : triage.priority === 'soon' ? 'next' : 'normal',
      due_at: due,
      notes: [item.place ? `Where: ${item.place}` : '', item.details, `From ${meta.sender?.name || meta.sender?.email}: ${meta.subject || ''}`].filter(Boolean).join('\n').slice(0, 2000),
    };
    if (existing.data?.[0]) {
      if (!['done', 'cancelled'].includes(existing.data[0].status)) await db.from('work_items').update(fields).eq('id', existing.data[0].id);
      ids.push(existing.data[0].id);
      continue;
    }
    const created = await db.from('work_items').insert({ ...fields, status: 'open', owner_type: 'founder', owner_name: firstName(settings), source_type: 'gmail', source_id: sourceId }).select('id').single();
    if (created.error) throw created.error;
    ids.push(created.data.id);
  }
  return ids;
}

// Close or reopen every task that came from one email.
export async function setEmailTasks(db, messageId, status) {
  const rows = await db.from('work_items').select('id,status,source_id').eq('source_type', 'gmail').like('source_id', `${messageId}#%`);
  if (rows.error) throw rows.error;
  const now = new Date().toISOString();
  for (const r of rows.data || []) {
    if (status === 'done' && !['done', 'cancelled'].includes(r.status)) await db.from('work_items').update({ status: 'done', completed_at: now }).eq('id', r.id);
    if (status === 'cancelled' && !['done', 'cancelled'].includes(r.status)) await db.from('work_items').update({ status: 'cancelled' }).eq('id', r.id);
    if (status === 'open' && r.status !== 'open') await db.from('work_items').update({ status: 'open', completed_at: null }).eq('id', r.id);
  }
}

// Read one email and record what it needs. Reply drafts also go to Gmail Drafts, threaded.
export async function triageOne(db, token, id, { today, fetchImpl, saveDraft = sendGmailMessage, settings = null } = {}) {
  settings = settings || await founderSettings(db);
  const meta = await gmailMetadata(token, id);
  if ((meta.label_ids || []).some((l) => SKIP_LABELS.includes(l))) return { id, kind: 'skip' };
  const { body } = await gmailBody(token, id).catch(() => ({ body: meta.snippet }));
  const row = { error: null, gmail_message_id: meta.message_id, gmail_thread_id: meta.thread_id, sender_name: meta.sender?.name || null, sender_email: meta.sender?.email || null, subject: meta.subject, snippet: meta.snippet, received_at: meta.received_at };
  try {
    const triage = noEmailReplies(await triageEmail(meta, body, { today, fetchImpl, settings }), platformOf(meta));
    Object.assign(row, { kind: triage.kind, summary: triage.summary, ask: triage.ask, due_date: triage.due_date, priority: triage.priority, items: triage.items, model: 'triage' });
    if (triage.kind === 'skip' || triage.kind === 'fyi') row.status = triage.kind === 'skip' ? 'dismissed' : 'open';
    if (triage.kind === 'reply' && await repliedInThread(token, meta.thread_id, meta.received_at).catch(() => false)) {
      // The founder already wrote back. Any other to-dos or events in the email still count.
      triage.items = triage.items.map((i) => (i.type === 'reply' ? { ...i, status: 'done' } : i));
      row.items = triage.items;
      if (triage.items.some((i) => ['todo', 'event'].includes(i.type))) { triage.kind = 'todo'; row.kind = 'todo'; }
      else { row.status = 'done'; row.handled_by = 'gmail'; row.handled_at = new Date().toISOString(); }
    }
    if (row.kind === 'reply' && row.status !== 'done') {
      const reply = await draftReply(meta, body, triage, { fetchImpl, settings });
      row.reply_subject = reply.subject; row.reply_body = reply.body;
      try {
        const draft = await saveDraft({ to: [meta.sender?.email].filter(Boolean), subject: reply.subject, body: reply.body, saveAsDraft: true, threadId: meta.thread_id, replyMessageId: meta.message_id });
        row.gmail_draft_id = draft?.id || null;
      } catch (e) { row.error = `Gmail draft: ${e.message}`.slice(0, 300); }
    }
    if ((triage.kind === 'reply' || triage.kind === 'todo') && row.status !== 'done') { const ids = await upsertWork(db, meta, triage, settings); row.work_item_id = ids[0] || null; }
    await headsUpFromEmail(db, meta, triage, { today }).catch((e) => { row.error = `Heads up: ${e.message}`.slice(0, 300); });
  } catch (e) {
    // Leave it unsaved so the next check reads it again.
    throw new Error(`Sorting did not finish: ${e.message}`.slice(0, 300));
  }
  const saved = await db.from('command_email_triage').upsert(row, { onConflict: 'gmail_message_id' }).select('id,kind,status').single();
  if (saved.error) throw saved.error;
  return saved.data;
}

// A sent reply closes the reply task. Other to-dos and events from the same email stay open.
async function closeReplyTask(db, row) {
  const n = (row.items || []).findIndex((i) => i.type === 'reply');
  const sourceId = `${row.gmail_message_id}#${n < 0 ? 0 : n}`;
  const now = new Date().toISOString();
  await db.from('work_items').update({ status: 'done', completed_at: now }).eq('source_type', 'gmail').eq('source_id', sourceId).neq('status', 'done');
  const others = (row.items || []).some((i, k) => k !== n && ['todo', 'event'].includes(i.type) && i.status !== 'done');
  if (others) await db.from('command_email_triage').update({ kind: 'todo', status: 'open', updated_at: now }).eq('id', row.id);
}

// Open replies the founder already answered in Gmail close on their own, along with their task.
export async function closeAnswered(db, token) {
  const open = await db.from('command_email_triage').select('id,gmail_message_id,gmail_thread_id,received_at,work_item_id,items').eq('kind', 'reply').eq('status', 'open').is('deleted_at', null).limit(60);
  if (open.error) throw open.error;
  let closed = 0;
  for (const row of open.data || []) {
    if (!(await repliedInThread(token, row.gmail_thread_id, row.received_at).catch(() => false))) continue;
    const now = new Date().toISOString();
    await db.from('command_email_triage').update({ status: 'done', handled_by: 'gmail', handled_at: now, updated_at: now }).eq('id', row.id);
    await closeReplyTask(db, row);
    closed += 1;
  }
  return closed;
}

export async function runEmailTriage(db, { days = 3, limit = RUN_LIMIT, today = easternDate(), fetchImpl } = {}) {
  const token = await getAccessToken();
  const ids = await listInboxIds(token, days);
  const known = new Set();
  for (let i = 0; i < ids.length; i += 100) {
    const seen = await db.from('command_email_triage').select('gmail_message_id,error').in('gmail_message_id', ids.slice(i, i + 100));
    if (seen.error) throw seen.error;
    // An email whose sorting failed earlier gets read again.
    (seen.data || []).filter((r) => !/^Sorting did not finish/.test(r.error || '')).forEach((r) => known.add(r.gmail_message_id));
  }
  const fresh = ids.filter((id) => !known.has(id)).slice(0, limit);
  const settings = await founderSettings(db);
  const results = await mapLimit(fresh, 4, (id) => triageOne(db, token, id, { today, fetchImpl, settings }).catch((e) => ({ id, error: e.message })));
  const closed = await closeAnswered(db, token).catch(() => 0);
  const count = (k) => results.filter((r) => r?.kind === k).length;
  return { read: fresh.length, waiting: ids.length - known.size - fresh.length, reply: count('reply'), todo: count('todo'), fyi: count('fyi'), skip: count('skip'), failed: results.filter((r) => r?.error).length, closed };
}

// Actions from the Email page.
export async function deleteGmailDraft(token, draftId) {
  if (!draftId) return;
  await gmailJson(token, `/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' }).catch(() => null);
}

export async function sendReply(db, row, { subject, body }, { send = sendGmailMessage } = {}) {
  const token = await getAccessToken();
  const to = [row.sender_email].filter(Boolean);
  if (!to.length) throw Object.assign(new Error('This email has no address to reply to.'), { status: 409 });
  const sent = await send({ to, subject: noDashes(subject || row.reply_subject), body: noDashes(body || row.reply_body), threadId: row.gmail_thread_id, replyMessageId: row.gmail_message_id });
  await deleteGmailDraft(token, row.gmail_draft_id);
  const now = new Date().toISOString();
  const saved = await db.from('command_email_triage').update({ status: 'sent', handled_by: 'command', handled_at: now, gmail_draft_id: null, reply_subject: subject || row.reply_subject, reply_body: body || row.reply_body, updated_at: now }).eq('id', row.id).select('*').single();
  if (saved.error) throw saved.error;
  await closeReplyTask(db, row);
  return { ...saved.data, gmail_message_sent: sent?.id || null };
}

export { parseFrom };
