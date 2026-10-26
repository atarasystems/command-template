import { withCommandAuth } from '../_lib/auth.js';
import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';
import { getAccessToken, gmailBody, gmailConfigured } from '../_lib/gmail.js';
import { deleteGmailDraft, draftReply, runEmailTriage, sendReply, setEmailTasks } from '../_lib/email-triage.js';
import { createGoogleCalendarEvent, getGoogleAccessToken } from '../_lib/google-calendar.js';
import { sendGmailMessage } from '../send-email.js';
import { noDashes } from '../_lib/updates.js';
import { aiProvider } from '../_lib/ai.js';
import { scanCalendar } from '../_lib/heads-up.js';

export const maxDuration = 300;

function clean(v) { return String(v || '').trim(); }

async function load(db) {
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const [open, fyi, handled] = await Promise.all([
    db.from('command_email_triage').select('*').in('kind', ['reply', 'todo']).eq('status', 'open').is('deleted_at', null).order('received_at', { ascending: false }).limit(200),
    db.from('command_email_triage').select('id,sender_name,sender_email,subject,summary,received_at,gmail_thread_id,status,items').eq('kind', 'fyi').eq('status', 'open').is('deleted_at', null).gte('received_at', since).order('received_at', { ascending: false }).limit(60),
    db.from('command_email_triage').select('id,kind,sender_name,subject,status,handled_by,handled_at').in('status', ['done', 'sent', 'dismissed']).neq('kind', 'skip').gte('updated_at', since).order('updated_at', { ascending: false }).limit(40),
  ]);
  for (const r of [open, fyi, handled]) if (r.error) throw r.error;
  const rows = open.data || [];
  const rank = { now: 0, soon: 1, normal: 2 };
  const sortRows = (list) => list.sort((a, b) => (rank[a.priority] - rank[b.priority]) || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')) || String(b.received_at).localeCompare(String(a.received_at)));
  return { reply: sortRows(rows.filter((r) => r.kind === 'reply')), todo: sortRows(rows.filter((r) => r.kind === 'todo')), fyi: fyi.data || [], handled: handled.data || [], gmail: gmailConfigured(), ai: aiProvider() === 'gemini' };
}

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) return;
  try {
    const db = getSupabase();
    if (req.method === 'GET') return sendData(res, await load(db));
    const body = bodyOf(req);
    const action = clean(body.action);
    if (['check_now', 'redraft'].includes(action) && aiProvider() !== 'gemini') return sendError(res, { code: 'GEMINI_NOT_CONNECTED', message: 'Add the Gemini key to Command first. The email assistant runs on Gemini.' }, 503);
    if (action === 'check_now') {
      if (!gmailConfigured()) return sendError(res, { code: 'GMAIL_NOT_CONNECTED', message: 'Gmail is not connected to Command.' }, 503);
      const any = await db.from('command_email_triage').select('id', { count: 'exact', head: true });
      const result = await runEmailTriage(db, { days: Math.min(Math.max(Number(body.days) || (any.count ? 3 : 7), 1), 14) });
      result.heads_up = await scanCalendar(db).catch((e) => ({ failed: e.message }));
      return sendData(res, result);
    }
    const current = await db.from('command_email_triage').select('*').eq('id', clean(body.id)).maybeSingle();
    if (current.error) throw current.error;
    if (!current.data) return sendError(res, { code: 'NOT_FOUND', message: 'That email is gone.' }, 404);
    const row = current.data;
    const now = new Date().toISOString();

    if (action === 'send') {
      if (row.status === 'sent') return sendData(res, row);
      return sendData(res, await sendReply(db, row, { subject: clean(body.subject), body: String(body.body || '').trim() }));
    }
    if (action === 'save_reply') {
      const patch = { reply_subject: noDashes(clean(body.subject) || row.reply_subject || ''), reply_body: noDashes(String(body.body || '').trim()), updated_at: now };
      // Keep the Gmail draft in step, so she can send from her phone too.
      if (row.gmail_draft_id) {
        const token = await getAccessToken();
        await deleteGmailDraft(token, row.gmail_draft_id);
        const draft = await sendGmailMessage({ to: [row.sender_email].filter(Boolean), subject: patch.reply_subject, body: patch.reply_body, saveAsDraft: true, threadId: row.gmail_thread_id, replyMessageId: row.gmail_message_id }).catch(() => null);
        patch.gmail_draft_id = draft?.id || null;
      }
      const saved = await db.from('command_email_triage').update(patch).eq('id', row.id).select('*').single();
      if (saved.error) throw saved.error;
      return sendData(res, saved.data);
    }
    if (action === 'redraft') {
      const token = await getAccessToken();
      const { body: text } = await gmailBody(token, row.gmail_message_id).catch(() => ({ body: row.snippet }));
      const meta = { sender: { name: row.sender_name, email: row.sender_email }, subject: row.subject, received_at: row.received_at, snippet: row.snippet };
      const ask = [row.ask || row.summary, clean(body.instruction) ? `Founder's note: ${clean(body.instruction)}` : ''].filter(Boolean).join('. ');
      const reply = await draftReply(meta, text, { ask, summary: row.summary });
      await deleteGmailDraft(token, row.gmail_draft_id);
      const draft = await sendGmailMessage({ to: [row.sender_email].filter(Boolean), subject: reply.subject, body: reply.body, saveAsDraft: true, threadId: row.gmail_thread_id, replyMessageId: row.gmail_message_id }).catch(() => null);
      const saved = await db.from('command_email_triage').update({ kind: 'reply', reply_subject: reply.subject, reply_body: reply.body, gmail_draft_id: draft?.id || null, updated_at: now }).eq('id', row.id).select('*').single();
      if (saved.error) throw saved.error;
      return sendData(res, saved.data);
    }
    if (action === 'done' || action === 'dismiss') {
      const saved = await db.from('command_email_triage').update({ status: action === 'done' ? 'done' : 'dismissed', handled_by: 'founder', handled_at: now, updated_at: now }).eq('id', row.id).select('*').single();
      if (saved.error) throw saved.error;
      await setEmailTasks(db, row.gmail_message_id, action === 'done' ? 'done' : 'cancelled');
      if (action === 'dismiss' && row.gmail_draft_id) await deleteGmailDraft(await getAccessToken(), row.gmail_draft_id);
      return sendData(res, saved.data);
    }
    if (action === 'restore') {
      const saved = await db.from('command_email_triage').update({ status: 'open', handled_by: null, handled_at: null, updated_at: now }).eq('id', row.id).select('*').single();
      if (saved.error) throw saved.error;
      await setEmailTasks(db, row.gmail_message_id, 'open');
      return sendData(res, saved.data);
    }
    if (action === 'item_done' || action === 'add_to_calendar') {
      const items = Array.isArray(row.items) ? row.items.slice() : [];
      const n = Number(body.index);
      const item = items[n];
      if (!item) return sendError(res, { code: 'NOT_FOUND', message: 'That item is gone.' }, 404);
      if (action === 'item_done') {
        items[n] = { ...item, status: 'done' };
        await db.from('work_items').update({ status: 'done', completed_at: now }).eq('source_type', 'gmail').eq('source_id', `${row.gmail_message_id}#${n}`).neq('status', 'done');
      } else {
        if (!item.date) return sendError(res, { code: 'NO_DATE', message: 'This item has no date to put on the calendar.' }, 409);
        const start = item.time ? `${item.date}T${item.time}:00` : item.date;
        const endTime = item.end_time || (item.time ? `${String(Math.min(23, Number(item.time.slice(0, 2)) + 1)).padStart(2, '0')}:${item.time.slice(3)}` : null);
        const nextDay = new Date(item.date + 'T12:00:00Z'); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
        const event = await createGoogleCalendarEvent(await getGoogleAccessToken(), {
          title: item.title, allDay: !item.time, startISO: start, endISO: item.time ? `${item.date}T${endTime}:00` : nextDay.toISOString().slice(0, 10),
          description: [item.place ? `Where: ${item.place}` : '', item.details, `From ${row.sender_name || row.sender_email}: ${row.subject || ''}`].filter(Boolean).join('\n'),
        });
        items[n] = { ...item, calendar_event_id: event?.id || null, calendar_link: event?.htmlLink || null };
      }
      const left = items.some((i) => ['todo', 'event', 'prepare', 'reply'].includes(i.type) && i.status !== 'done');
      const saved = await db.from('command_email_triage').update({ items, ...(left || row.kind === 'reply' ? {} : { status: 'done', handled_by: 'founder', handled_at: now }), updated_at: now }).eq('id', row.id).select('*').single();
      if (saved.error) throw saved.error;
      return sendData(res, saved.data);
    }
    if (action === 'make_todo' || action === 'make_reply') {
      const saved = await db.from('command_email_triage').update({ kind: action === 'make_todo' ? 'todo' : 'reply', status: 'open', updated_at: now }).eq('id', row.id).select('*').single();
      if (saved.error) throw saved.error;
      return sendData(res, saved.data);
    }
    return sendError(res, { code: 'VALIDATION_ERROR', message: 'Unknown action' });
  } catch (error) {
    console.error('[Email]', error?.message || error);
    return sendError(res, error);
  }
}

export default withCommandAuth(handler);
