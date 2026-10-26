import { withCommandAuth } from '../_lib/auth.js';
import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';
import { getGoogleAccessToken, createGoogleCalendarEvent } from '../_lib/google-calendar.js';
import { getAccessToken, GMAIL_API, gmailConfigured } from '../_lib/gmail.js';
import { brandCodes, SHARE_LEVELS, AUDIENCES, easternDate, extractFollowups, createReview, reviewEmailRaw, noDashes } from '../_lib/updates.js';
import { founderSettings } from '../_lib/founder-settings.js';

export const maxDuration = 60;

function fail(res, status, message, code = 'UPDATES_ERROR') { return res.status(status).json({ ok: false, error: { code, message } }); }
function clean(v) { return String(v || '').trim(); }
function addDay(iso) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }

// Turns a follow-up into a task, and a calendar entry when asked.
export async function addFollowupToTasks(db, { title, due_date, calendar = false, sourceType, sourceId }) {
  const task = await db.from('work_items').insert({
    title: noDashes(title).slice(0, 240), category: 'general', status: 'open', priority: 'normal', owner_type: 'founder',
    due_at: due_date ? `${due_date}T21:00:00Z` : null, source_type: sourceType, source_id: sourceId, notes: 'Added from Updates.',
  }).select('id').single();
  if (task.error) throw task.error;
  let calendarAdded = false;
  if (calendar && due_date) {
    try { await createGoogleCalendarEvent(await getGoogleAccessToken(), { title, startISO: due_date, endISO: addDay(due_date), allDay: true, description: 'Follow-up from Command Updates.' }); calendarAdded = true; } catch (e) { console.error('[Updates calendar]', e.message); }
  }
  return { work_item_id: task.data.id, calendar_added: calendarAdded };
}

async function load(db, days) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const [updates, reviews] = await Promise.all([
    db.from('command_updates').select('*').is('deleted_at', null).gte('entry_date', since).order('entry_date', { ascending: false }).order('created_at', { ascending: false }),
    db.from('command_reviews').select('*').is('deleted_at', null).order('period_end', { ascending: false }).order('created_at', { ascending: false }).limit(30),
  ]);
  if (updates.error) throw updates.error;
  if (reviews.error) throw reviews.error;
  return { today: easternDate(), updates: updates.data || [], reviews: reviews.data || [], gmail: gmailConfigured() };
}

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) return;
  try {
    const db = getSupabase();
    if (req.method === 'GET') return sendData(res, await load(db, Math.min(Number(req.query?.days) || 45, 400)));

    const body = bodyOf(req);
    const action = clean(body.action) || 'add';
    const now = new Date().toISOString();

    if (action === 'add') {
      const text = clean(body.body);
      if (!text) return sendError(res, { code: 'VALIDATION_ERROR', message: 'Write what happened first.' });
      const BRANDS = brandCodes(await founderSettings(db));
      const brand = BRANDS.includes(body.brand) ? body.brand : null;
      const share = SHARE_LEVELS.includes(body.share_level) ? body.share_level : 'private';
      let followups = [];
      try { followups = await extractFollowups(text, { settings: await founderSettings(db) }); } catch (e) { console.error('[Updates follow-ups]', e.message); }
      const row = await db.from('command_updates').insert({ body: text, brand, share_level: share, followups, entry_date: /^\d{4}-\d{2}-\d{2}$/.test(body.entry_date || '') ? body.entry_date : easternDate() }).select('*').single();
      if (row.error) throw row.error;
      return sendData(res, row.data, 201);
    }

    if (action === 'update') {
      const patch = { updated_at: now };
      if (SHARE_LEVELS.includes(body.share_level)) patch.share_level = body.share_level;
      if (Object.hasOwn(body, 'brand')) patch.brand = brandCodes(await founderSettings(db)).includes(body.brand) ? body.brand : null;
      if (clean(body.body)) patch.body = clean(body.body);
      const row = await db.from('command_updates').update(patch).eq('id', body.id).select('*').single();
      if (row.error) throw row.error;
      return sendData(res, row.data);
    }

    if (action === 'delete' || action === 'restore') {
      const table = body.kind === 'review' ? 'command_reviews' : 'command_updates';
      const row = await db.from(table).update({ deleted_at: action === 'delete' ? now : null, updated_at: now }).eq('id', body.id).select('id').single();
      if (row.error) throw row.error;
      return sendData(res, { id: body.id, deleted: action === 'delete' });
    }

    if (action === 'followup') {
      // Add or skip one suggested follow-up on an update or a review.
      const table = body.kind === 'review' ? 'command_reviews' : 'command_updates';
      const current = await db.from(table).select('id,followups').eq('id', body.id).single();
      if (current.error) throw current.error;
      const list = Array.isArray(current.data.followups) ? current.data.followups.slice() : [];
      const index = Number(body.index);
      if (!list[index]) return sendError(res, { code: 'NOT_FOUND', message: 'That follow-up is gone.' }, 404);
      let entry = { ...list[index] };
      if (body.skip) entry.status = 'skipped';
      else {
        const title = clean(body.title) || entry.title;
        const due = /^\d{4}-\d{2}-\d{2}$/.test(body.due_date || '') ? body.due_date : (body.due_date === '' ? null : entry.due_date);
        const added = await addFollowupToTasks(db, { title, due_date: due, calendar: body.calendar === true, sourceType: table === 'command_reviews' ? 'review' : 'update', sourceId: body.id });
        entry = { ...entry, title, due_date: due, status: 'added', ...added };
      }
      list[index] = entry;
      const saved = await db.from(table).update({ followups: list, updated_at: now }).eq('id', body.id).select('*').single();
      if (saved.error) throw saved.error;
      return sendData(res, saved.data);
    }

    if (action === 'review') {
      const kind = body.kind === 'month' ? 'month' : 'week';
      const audience = AUDIENCES.includes(body.audience) ? body.audience : 'me';
      const review = await createReview(db, { kind, audience, refDate: /^\d{4}-\d{2}-\d{2}$/.test(body.ref_date || '') ? body.ref_date : easternDate() });
      return sendData(res, review, 201);
    }

    if (action === 'edit_review') {
      const patch = { updated_at: now };
      if (clean(body.title)) patch.title = noDashes(clean(body.title));
      if (clean(body.body)) patch.body = noDashes(body.body);
      const row = await db.from('command_reviews').update(patch).eq('id', body.id).select('*').single();
      if (row.error) throw row.error;
      return sendData(res, row.data);
    }

    if (action === 'send_review') {
      const to = clean(body.to);
      if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]+(\s*,\s*[^\s@,]+@[^\s@,]+\.[^\s@,]+)*$/.test(to)) return sendError(res, { code: 'VALIDATION_ERROR', message: 'Add a valid email address. Separate more than one with commas.' });
      if (!gmailConfigured()) return fail(res, 503, 'Gmail is not connected to Command.', 'GMAIL_NOT_CONNECTED');
      const review = await db.from('command_reviews').select('*').eq('id', body.id).single();
      if (review.error) throw review.error;
      if (review.data.audience === 'me') return sendError(res, { code: 'PRIVATE_REVIEW', message: 'This review is just for you. Make a Team or Investors version to share it.' }, 409);
      const subject = clean(body.subject) || review.data.title;
      const raw = reviewEmailRaw({ to, subject, body: noDashes(clean(body.body) || review.data.body) });
      const asDraft = body.draft === true;
      const token = await getAccessToken();
      const response = await fetch(asDraft ? `${GMAIL_API}/drafts` : `${GMAIL_API}/messages/send`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(asDraft ? { message: { raw } } : { raw }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return fail(res, 502, data?.error?.message || 'Gmail could not take this email.', 'GMAIL_FAILED');
      const row = await db.from('command_reviews').update(asDraft ? { sent_to: to, updated_at: now } : { status: 'sent', sent_to: to, sent_at: now, updated_at: now }).eq('id', body.id).select('*').single();
      if (row.error) throw row.error;
      return sendData(res, { ...row.data, saved_as_draft: asDraft });
    }

    return sendError(res, { code: 'VALIDATION_ERROR', message: 'Unknown action' });
  } catch (error) {
    console.error('[Updates]', error?.message || error);
    const status = Number(error?.status) || 500;
    if (status < 500) return fail(res, status, error.message, error.code || 'UPDATES_ERROR');
    return fail(res, status, status === 503 ? error.message : 'That did not save. Try again in a moment.');
  }
}

export default withCommandAuth(handler);
