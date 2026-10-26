import { withCommandAuth } from '../_lib/auth.js';
import { calendarEventId, verifyPendingCalendarAction } from '../_lib/river-calendar-action.js';
import { createGoogleCalendarEvent, getGoogleAccessToken, getGoogleCalendarEvent } from '../_lib/google-calendar.js';

function payloadFor(candidate) {
  const next = new Date(`${candidate.date}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  if (candidate.all_day) return { title: candidate.title, startISO: candidate.date, endISO: next.toISOString().slice(0, 10), description: candidate.description || '', allDay: true, eventId: undefined };
  const startISO = `${candidate.date}T${candidate.start_time}:00`;
  const endISO = candidate.end_time ? `${candidate.date}T${candidate.end_time}:00` : new Date(new Date(`${startISO}-04:00`).getTime() + 30 * 60000).toISOString();
  return { title: candidate.title, startISO, endISO, description: [candidate.description, candidate.meeting_url].filter(Boolean).join('\n\n'), allDay: false };
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: { message: 'Method not allowed' } });
  const action = verifyPendingCalendarAction(req, req.body?.action_token);
  if (!action) return res.status(400).json({ ok: false, error: { message: 'This calendar preview has expired or is no longer valid.' } });
  const indexes = Array.isArray(req.body?.selected_indexes) ? [...new Set(req.body.selected_indexes)].filter((index) => Number.isInteger(index) && index >= 0 && index < action.candidates.length) : [];
  const duplicateOverrides = new Set(Array.isArray(req.body?.allow_duplicate_indexes) ? req.body.allow_duplicate_indexes.filter((index) => Number.isInteger(index)) : []);
  const blockedDuplicates = indexes.filter((index) => action.candidates[index].duplicate && !duplicateOverrides.has(index));
  if (blockedDuplicates.length) return res.status(409).json({ ok: false, error: { message: 'A selected item may already be on your calendar. Confirm that duplicate explicitly before adding it.' }, data: { duplicate_indexes: blockedDuplicates } });
  if (!indexes.length) return res.status(400).json({ ok: false, error: { message: 'Choose at least one prepared calendar item.' } });
  try {
    const accessToken = await getGoogleAccessToken(); const created = []; const alreadyExists = []; const alreadyHandled = [];
    for (const index of indexes) {
      const candidate = action.candidates[index];
      const deterministicId = calendarEventId(action.tokenHash, index);
      try { await getGoogleCalendarEvent(accessToken, deterministicId); alreadyHandled.push({ index, title: candidate.title, date: candidate.date }); continue; }
      catch (error) { if (error.statusCode !== 404) return res.status(502).json({ ok: false, data: { created, already_exists: alreadyExists, already_handled: alreadyHandled, failed_index: index }, error: { message: error.message } }); }
      try { const event = await createGoogleCalendarEvent(accessToken, { ...payloadFor(candidate), eventId: deterministicId }); created.push({ index, title: candidate.title, date: candidate.date, eventId: event.id }); }
      catch (error) { if (error.statusCode === 409) alreadyExists.push({ index, title: candidate.title, date: candidate.date }); else return res.status(502).json({ ok: false, data: { created, already_exists: alreadyExists, failed_index: index }, error: { message: error.message } }); }
    }
    return res.status(200).json({ ok: true, data: { created, already_exists: alreadyExists, already_handled: alreadyHandled } });
  } catch (error) { return res.status(error.statusCode || 502).json({ ok: false, error: { message: error.message } }); }
}

export default withCommandAuth(handler);
