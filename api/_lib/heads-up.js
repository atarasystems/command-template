// Heads up: reads every upcoming event in full (the invite, plus related emails) and pulls out
// what is easy to miss: what the meeting really is, what to prepare, what to bring, when to arrive.
import { aiText } from './ai.js';
import { getGoogleAccessToken } from './google-calendar.js';
import { GMAIL_API, getAccessToken, gmailBody } from './gmail.js';
import { easternDate, noDashes, parseJson } from './updates.js';
import { DEFAULT_SETTINGS, envTimeZone, founderSettings, firstName, companyName } from './founder-settings.js';
import { APP_EVENT_MARKER } from './google-calendar.js';

export const SCAN_DAYS = 14;
const SCAN_LIMIT = 12;

export function headsUpPrompt(today, settings = DEFAULT_SETTINGS) {
  const f = settings?.founder || {};
  return [
    'You help ' + (f.name || 'the founder') + ', ' + (f.title || 'founder') + ' of ' + companyName(settings) + ', walk into every meeting and event prepared. Today is ' + today + ' (' + envTimeZone() + ').',
    'Read the event and any related emails in full, including the bottom of each email. Find what is easy to miss and costly to miss.',
    'Look hard for:',
    '- what the meeting really is when it differs from its title (for example an "interview" where she must present a 5 minute pitch deck);',
    '- anything to prepare, write, practice, read, fill out, send or submit before it, and any topics she is asked to cover;',
    '- when to arrive, where exactly to go, parking, dress, what to bring, tech to test (camera, slides, screen share);',
    '- a deadline before the event.',
    'heads_up: one or two plain sentences with the single most important thing she must know or do. Lead with the action. Leave it empty if the event holds nothing beyond its title, time and link.',
    'prep: a short checklist of concrete steps, each one line, in the order she should do them. Include every topic she was asked to cover. Leave it empty when there is nothing to prepare.',
    'Never invent details. Use only what is written.' + (settings?.voice?.no_dashes ? ' Never use em dashes or en dashes.' : ''),
    'Return only JSON: {"heads_up": "...", "prep": ["..."]}',
  ].join('\n');
}

function clip(text, max) { const s = String(text || ''); return s.length > max ? s.slice(0, max) + '\n[cut]' : s; }
function stripHtml(html) {
  return String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>|<\/div>|<\/li>/gi, '\n').replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();
}

export function cleanHeadsUp(raw) {
  const prep = (Array.isArray(raw?.prep) ? raw.prep : []).map((p) => noDashes(String(p || '').trim())).filter(Boolean).slice(0, 12).map((text) => ({ text, done: false }));
  const headsUp = noDashes(String(raw?.heads_up || '').trim()).slice(0, 600);
  return { heads_up: headsUp || null, prep, has_news: Boolean(headsUp || prep.length) };
}

function joinLink(event, text) {
  if (event.hangoutLink) return event.hangoutLink;
  const entry = (event.conferenceData?.entryPoints || []).find((e) => e.entryPointType === 'video');
  if (entry?.uri) return entry.uri;
  const m = String(text || '').match(/https?:\/\/[^\s)"'<>]*(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com)[^\s)"'<>]*/i);
  return m ? m[0] : null;
}

// Events worth reading: ones with real detail in them. The founder's own routine blocks are left alone.
export function worthReading(event) {
  if (event.status === 'cancelled') return false;
  const text = stripHtml(event.description || '');
  const own = event.organizer?.self && !(event.attendees || []).some((a) => !a.self);
  if (own && event.recurringEventId) return false;
  if (text.includes(APP_EVENT_MARKER)) return false;
  return text.length >= 40 || Boolean(event.location && !own);
}

async function upcomingEvents(token, days) {
  const now = new Date();
  const params = new URLSearchParams({ timeMin: now.toISOString(), timeMax: new Date(now.getTime() + days * 86400000).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '150' });
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || 'Calendar lookup failed');
  return data.items || [];
}

// Emails about the same event, such as a booking confirmation that says "present a pitch deck".
async function relatedEmails(gmailToken, title) {
  const words = String(title || '').replace(/[^\w\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3).slice(0, 5);
  if (words.length < 2) return '';
  const q = `newer_than:45d ${words.map((w) => `"${w}"`).join(' ')}`;
  const response = await fetch(`${GMAIL_API}/messages?maxResults=3&q=${encodeURIComponent(q)}`, { headers: { Authorization: `Bearer ${gmailToken}` } });
  const data = await response.json().catch(() => ({}));
  const out = [];
  for (const m of (data.messages || []).slice(0, 2)) {
    const b = await gmailBody(gmailToken, m.id).catch(() => null);
    if (b?.body) out.push(clip(b.body, 3500));
  }
  return out.join('\n\n---\n\n');
}

export function eventForAi(event, emails) {
  const start = event.start?.dateTime || event.start?.date || '';
  return [`EVENT: ${event.summary || ''}`, `WHEN: ${start}`, event.location ? `WHERE: ${event.location}` : '', `ORGANIZER: ${event.organizer?.displayName || event.organizer?.email || ''}`,
    '', 'INVITE DETAILS:', clip(stripHtml(event.description || ''), 6000), emails ? `\nRELATED EMAILS:\n${emails}` : ''].filter((x) => x !== '').join('\n');
}

export async function readEvent(event, emails, { today = easternDate(), fetchImpl, settings = DEFAULT_SETTINGS } = {}) {
  const text = await aiText({ system: headsUpPrompt(today, settings), user: eventForAi(event, emails), tier: 'write', maxTokens: 900, temperature: 0.1 }, { fetchImpl });
  return cleanHeadsUp(parseJson(text));
}

export async function scanCalendar(db, { days = SCAN_DAYS, limit = SCAN_LIMIT, today = easternDate(), fetchImpl } = {}) {
  const settings = await founderSettings(db);
  const token = await getGoogleAccessToken();
  const events = (await upcomingEvents(token, days)).filter(worthReading);
  const known = new Map();
  if (events.length) {
    const rows = await db.from('command_heads_up').select('source_id,source_updated').in('source_id', events.map((e) => `cal:${e.id}`));
    if (rows.error) throw rows.error;
    (rows.data || []).forEach((r) => known.set(r.source_id, r.source_updated));
  }
  const fresh = events.filter((e) => known.get(`cal:${e.id}`) !== e.updated).slice(0, limit);
  let gmailToken = null;
  try { gmailToken = await getAccessToken(); } catch { gmailToken = null; }
  let found = 0, failed = 0;
  for (const event of fresh) {
    try {
      const emails = gmailToken ? await relatedEmails(gmailToken, event.summary).catch(() => '') : '';
      const read = await readEvent(event, emails, { today, fetchImpl, settings });
      const text = stripHtml(event.description || '');
      const existing = await db.from('command_heads_up').select('id,prep,acknowledged_at,heads_up').eq('source_id', `cal:${event.id}`).maybeSingle();
      const changed = existing.data && (existing.data.heads_up || '') !== (read.heads_up || '');
      const row = {
        source: 'calendar', source_id: `cal:${event.id}`, source_updated: event.updated, title: noDashes(event.summary || 'Event').slice(0, 300),
        starts_at: event.start?.dateTime || (event.start?.date ? `${event.start.date}T12:00:00Z` : null), ends_at: event.end?.dateTime || null, all_day: Boolean(event.start?.date),
        location: event.location || null, join_link: joinLink(event, text), heads_up: read.heads_up, prep: read.prep,
        // Every real appointment shows, even when there is nothing extra to prepare.
        has_news: true,
        // A changed invite needs a fresh look, even if she already pressed Got it.
        ...(changed ? { acknowledged_at: null } : {}), updated_at: new Date().toISOString(),
      };
      const saved = await db.from('command_heads_up').upsert(row, { onConflict: 'source_id' });
      if (saved.error) throw saved.error;
      if (read.has_news) found += 1;
    } catch (e) { failed += 1; console.error('[Heads up]', e.message); }
  }
  return { events: events.length, read: fresh.length, found, failed };
}

// From the email assistant: an email with an event and things to prepare becomes a heads up too.
export async function headsUpFromEmail(db, meta, triage, { today = easternDate() } = {}) {
  const items = triage.items || [];
  const event = items.find((i) => i.type === 'event' && i.date);
  const prepItems = items.filter((i) => i.type === 'prepare');
  if (!event && !prepItems.length) return null;
  // Every dated event goes to Heads up, since Work no longer holds events.
  const date = event?.date || prepItems.find((i) => i.date)?.date;
  if (!date || date < today) return null;
  const start = event?.time ? new Date(`${date}T${event.time}:00-04:00`).toISOString() : `${date}T12:00:00Z`;
  const row = {
    source: 'email', source_id: `mail:${meta.message_id}`, source_updated: meta.received_at, title: noDashes(event?.title || meta.subject || 'Event').slice(0, 300),
    starts_at: start, all_day: !event?.time, location: event?.place || null, join_link: null,
    heads_up: triage.heads_up || null,
    prep: prepItems.map((i) => ({ text: [i.title, i.details].filter(Boolean).join(': ').slice(0, 400), done: false })),
    has_news: true, updated_at: new Date().toISOString(),
  };
  const saved = await db.from('command_heads_up').upsert(row, { onConflict: 'source_id' });
  if (saved.error) throw saved.error;
  return row;
}

// The same event often arrives more than once: from the calendar and from one or more emails. Those become one
// heads up: the most complete one stays, takes the other steps and details, and the copies are removed.
const SMALL_WORDS = new Set(['with', 'from', 'your', 'this', 'that', 'session', 'meeting', 'event', 'call', 'day', 'person', 'virtual', 'online', 'zoom']);
function titleWords(title) { return new Set(String(title || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length >= 4 && !SMALL_WORDS.has(w))); }
function easternDay(iso) { return new Date(iso).toLocaleDateString('en-CA', { timeZone: envTimeZone() }); }
export function sameEvent(a, b) {
  if (!a?.starts_at || !b?.starts_at || easternDay(a.starts_at) !== easternDay(b.starts_at)) return false;
  const close = Math.abs(new Date(a.starts_at) - new Date(b.starts_at)) <= 3 * 3600000 || a.all_day || b.all_day;
  if (!close) return false;
  const x = titleWords(a.title), y = titleWords(b.title);
  let shared = 0; x.forEach((w) => { if (y.has(w)) shared += 1; });
  return shared >= 2 || (shared >= 1 && Math.min(x.size, y.size) <= 2);
}
function stepKey(text) { return String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 40); }
export function mergeSameEvents(rows) {
  const groups = [];
  for (const row of rows) {
    const group = groups.find((g) => g.some((r) => sameEvent(r, row)));
    if (group) group.push(row); else groups.push([row]);
  }
  const keep = []; const merged = []; const removed = [];
  for (const group of groups) {
    if (group.length === 1) { keep.push(group[0]); continue; }
    const score = (r) => (Array.isArray(r.prep) ? r.prep.length : 0) * 10 + (r.heads_up ? 5 : 0) + (r.source === 'calendar' ? 2 : 0) + (r.acknowledged_at ? 1 : 0);
    const sorted = group.slice().sort((a, b) => score(b) - score(a));
    const main = { ...sorted[0], prep: Array.isArray(sorted[0].prep) ? sorted[0].prep.slice() : [] };
    const seen = new Set(main.prep.map((p) => stepKey(p.text)));
    for (const other of sorted.slice(1)) {
      for (const step of other.prep || []) { const k = stepKey(step.text); if (k && !seen.has(k)) { seen.add(k); main.prep.push(step); } }
      main.location = main.location || other.location || null;
      main.join_link = main.join_link || other.join_link || null;
      main.heads_up = main.heads_up || other.heads_up || null;
      removed.push(other.id);
    }
    keep.push(main); merged.push(main);
  }
  return { keep, merged, removed };
}

export async function upcomingHeadsUp(db, { days = 7 } = {}) {
  const from = new Date(Date.now() - 2 * 3600000).toISOString();
  const to = new Date(Date.now() + days * 86400000).toISOString();
  const rows = await db.from('command_heads_up').select('*').eq('has_news', true).is('dismissed_at', null).gte('starts_at', from).lte('starts_at', to).order('starts_at', { ascending: true }).limit(30);
  if (rows.error) throw rows.error;
  const { keep, merged, removed } = mergeSameEvents(rows.data || []);
  if (removed.length) {
    const now = new Date().toISOString();
    for (const row of merged) {
      const saved = await db.from('command_heads_up').update({ prep: row.prep, location: row.location, join_link: row.join_link, heads_up: row.heads_up, updated_at: now }).eq('id', row.id);
      if (saved.error) throw saved.error;
    }
    const gone = await db.from('command_heads_up').update({ dismissed_at: now, updated_at: now }).in('id', removed);
    if (gone.error) throw gone.error;
  }
  return keep;
}
