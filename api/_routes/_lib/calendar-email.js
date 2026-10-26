import { envTimeZone } from './founder-settings.js';
const MONTHS = Object.freeze({
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
});

const WEEKDAYS = Object.freeze({ sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 });
const EASTERN = envTimeZone();

function parts(date, timeZone = EASTERN) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(date)).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
}

function dateKey(date, timeZone = EASTERN) {
  const p = parts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

function addDays(key, days) {
  const [year, month, day] = key.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function resolveEmailDate(phrase, receivedAt, timeZone = EASTERN) {
  const reference = new Date(receivedAt);
  if (Number.isNaN(reference.getTime())) return null;
  const base = dateKey(reference, timeZone);
  const lower = String(phrase || '').toLowerCase();
  if (/\btomorrow\b/.test(lower)) return addDays(base, 1);
  if (/\btoday\b|\btonight\b/.test(lower)) return base;
  const weekday = Object.keys(WEEKDAYS).find((name) => new RegExp(`\\b${name}\\b`, 'i').test(lower));
  if (weekday) {
    const current = new Date(`${base}T12:00:00Z`).getUTCDay();
    let delta = WEEKDAYS[weekday] - current;
    if (delta < 0) delta += 7;
    return addDays(base, delta);
  }
  return null;
}

export function parseAbsoluteDate(text, receivedAt, timeZone = EASTERN) {
  const match = String(text || '').match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i);
  if (!match) return null;
  const year = Number(match[3] || dateKey(receivedAt, timeZone).slice(0, 4));
  const month = MONTHS[match[1].toLowerCase()];
  const day = Number(match[2]);
  if (!month || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseTime(text) {
  const match = String(text || '').match(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3].toUpperCase();
  if (hour < 1 || hour > 12 || minute > 59) return null;
  if (meridiem === 'PM' && hour !== 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function parseTimes(text) {
  return [...String(text || '').matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM)\b/gi)].map((match) => parseTime(match[0])).filter(Boolean).slice(0, 2);
}

function sourceUrl(text) {
  return String(text || '').match(/https?:\/\/[^\s)>]+/i)?.[0] || null;
}

function isNonEventContext(text) {
  return /\b(available after|usually meet|ran from|opened|historical|example|quoted|previously|last year)\b/i.test(text)
    && !/\b(deadline|due|meeting|call|session|competition|conference|workshop|event)\b/i.test(text);
}

export function extractCalendarCandidates({ subject = '', body = '', received_at: receivedAt }) {
  const content = `${subject}\n${String(body || '').slice(0, 50000)}`;
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidates = [];
  for (const line of lines) {
    if (isNonEventContext(line)) continue;
    const relative = line.match(/\b(today|tonight|tomorrow|this\s+(?:afternoon|evening|week)|next\s+week|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i)?.[0];
    const date = parseAbsoluteDate(line, receivedAt) || (relative ? resolveEmailDate(relative, receivedAt) : null);
    if (!date) continue;
    const times = parseTimes(line);
    const time = times[0] || null;
    const deadline = /\b(deadline|applications?\s+(?:close|due)|due by|submit by)\b/i.test(line);
    const url = sourceUrl(line);
    const title = deadline ? `${subject || 'Application'} deadline` : (subject || line.replace(/https?:\/\/\S+/g, '').trim()).slice(0, 140);
    candidates.push({ title, date, start_time: time, end_time: times[1] || null, all_day: !time, timezone: EASTERN, location: null, meeting_url: url, description: line.slice(0, 1000), source_subject: subject || '', source_sender: null, deadline, source_date: receivedAt });
  }
  const deduped = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const key = [candidate.title.toLowerCase(), candidate.date, candidate.start_time || 'all-day'].join('|');
    if (!seen.has(key)) { seen.add(key); deduped.push(candidate); }
  }
  return deduped;
}

export function eventOverlaps(candidate, existing) {
  if (!candidate || !existing) return false;
  const existingDate = existing.start ? dateKey(existing.start) : existing.date;
  if (candidate.date !== existingDate) return false;
  if (candidate.all_day || existing.allDay) return String(candidate.title).toLowerCase() === String(existing.title).toLowerCase();
  if (!candidate.start_time || !existing.start) return false;
  const existingTime = new Intl.DateTimeFormat('en-US', { timeZone: EASTERN, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(existing.start));
  return existingTime === candidate.start_time && (String(existing.title).toLowerCase().includes(String(candidate.title).toLowerCase().slice(0, 24)) || String(candidate.title).toLowerCase().includes(String(existing.title).toLowerCase().slice(0, 24)));
}

export const calendarEmailTimeZone = EASTERN;
