import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanTriage, triagePrompt, replyPrompt, triageOne, runEmailTriage } from '../api/_lib/email-triage.js';

function fakeDb(tables) {
  return {
    from(table) {
      const rows = (tables[table] ||= []);
      let filters = [], op = 'select', patch = null, upsertRow = null, insertRow = null;
      const q = {
        select() { return q; }, order() { return q; }, limit() { return q; }, gte() { return q; },
        eq(c, v) { filters.push((r) => r[c] === v); return q; }, neq(c, v) { filters.push((r) => r[c] !== v); return q; },
        is(c, v) { filters.push((r) => (r[c] ?? null) === v); return q; }, in(c, vs) { filters.push((r) => vs.includes(r[c])); return q; },
        not() { return q; }, like(c, pat) { const pre = pat.replace(/%$/, ''); filters.push((r) => String(r[c] || '').startsWith(pre)); return q; },
        update(v) { op = 'update'; patch = v; return q; },
        insert(v) { op = 'insert'; insertRow = { id: 'w' + (rows.length + 1), ...v }; return q; },
        upsert(v) { op = 'upsert'; upsertRow = v; return q; },
        run() {
          if (op === 'insert') { rows.push(insertRow); return { data: [insertRow], error: null }; }
          if (op === 'upsert') { const hit = rows.find((r) => r.gmail_message_id === upsertRow.gmail_message_id); if (hit) Object.assign(hit, upsertRow); else rows.push({ id: 't' + (rows.length + 1), status: 'open', ...upsertRow }); return { data: [rows.find((r) => r.gmail_message_id === upsertRow.gmail_message_id)], error: null }; }
          const hit = rows.filter((r) => filters.every((f) => f(r)));
          if (op === 'update') hit.forEach((r) => Object.assign(r, patch));
          return { data: hit, error: null, count: hit.length };
        },
        single() { const r = q.run(); return Promise.resolve({ data: r.data[0] ?? null, error: null }); },
        maybeSingle() { return q.single(); },
        then(a, b) { return Promise.resolve(q.run()).then(a, b); },
      };
      return q;
    },
  };
}

const b64 = (s) => Buffer.from(s).toString('base64url');
function gmailAndAi({ kind = 'reply', repliedAlready = false, items } = {}) {
  const calls = { ai: [], drafts: 0 };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const ok = (data) => ({ ok: true, status: 200, json: async () => data });
    if (u.includes('oauth2.googleapis.com')) return ok({ access_token: 'tok' });
    if (u.includes('generativelanguage')) {
      const body = JSON.parse(init.body); calls.ai.push(body);
      const system = body.systemInstruction.parts[0].text;
      const text = system.startsWith('You sort email')
        ? JSON.stringify({ kind, summary: 'Maya asks for a call next week about the pilot.', priority: 'soon', category: 'client', items: items || [{ type: kind, title: kind === 'reply' ? 'Pick a time for a call' : 'Send the signed form', date: '2026-10-09', time: '', place: '', details: '' }] })
        : JSON.stringify({ subject: 'Re: Pilot call', body: 'Hi Maya,\n\nThanks for reaching out. I can talk [day and time that works].\n\nMaya' });
      return ok({ candidates: [{ content: { parts: [{ text }] } }] });
    }
    if (u.includes('/messages?')) return ok({ messages: [{ id: 'm1' }] });
    if (u.includes('/messages/m1?format=metadata')) return ok({ id: 'm1', threadId: 'th1', labelIds: ['INBOX', 'UNREAD'], snippet: 'Can we find time', payload: { headers: [{ name: 'From', value: 'Maya Lee <maya@client.com>' }, { name: 'Subject', value: 'Pilot call' }, { name: 'Date', value: 'Tue, 06 Oct 2026 14:00:00 -0400' }, { name: 'Message-ID', value: '<abc@client.com>' }] } });
    if (u.includes('/messages/m1?format=full')) return ok({ id: 'm1', threadId: 'th1', payload: { mimeType: 'text/plain', body: { data: b64('Hi Maya, can we find time next week to talk about the pilot? Maya') } } });
    if (u.includes('/threads/th1')) return ok({ id: 'th1', messages: repliedAlready ? [{ labelIds: ['SENT'], internalDate: String(Date.parse('2026-10-07T10:00:00Z')) }] : [] });
    if (u.includes('/drafts')) { calls.drafts += 1; return ok({ id: 'd1', message: { id: 'x' } }); }
    throw new Error('unexpected fetch ' + u);
  };
  return calls;
}

test('prompts use plain words and never use long dashes', () => {
  for (const p of [triagePrompt('2026-10-07'), replyPrompt()]) assert.doesNotMatch(p, /[–—]/);
  assert.match(replyPrompt(), /\[day and time that works\]/);
  assert.match(replyPrompt(), /Never invent/);
});

test('bad AI output is made safe', () => {
  assert.deepEqual(cleanTriage({ kind: 'weird', due_date: 'next week', priority: 'asap', category: 'x', items: [{ type: 'nonsense', title: 'A note' }, { title: '' }] }, '2026-10-07'), { kind: 'fyi', summary: '', ask: '', due_date: null, priority: 'normal', category: 'general', heads_up: null, items: [{ type: 'info', title: 'A note', date: null, time: null, end_time: null, place: '', details: '', status: 'open' }] });
});

test('an email that needs a reply gets a drafted reply, a Gmail draft and a task, and is never sent', async () => {
  process.env.GEMINI_API_KEY = 'g'; process.env.GMAIL_CLIENT_ID = 'a'; process.env.GMAIL_CLIENT_SECRET = 'b'; process.env.GMAIL_REFRESH_TOKEN = 'c';
  const calls = gmailAndAi();
  const tables = {};
  const result = await runEmailTriage(fakeDb(tables), { days: 3, today: '2026-10-07' });
  assert.equal(result.reply, 1);
  const row = tables.command_email_triage[0];
  assert.equal(row.kind, 'reply');
  assert.equal(row.status, 'open');
  assert.match(row.reply_body, /\[day and time that works\]/);
  assert.equal(row.gmail_draft_id, 'd1');
  assert.equal(calls.drafts, 1, 'saved as a Gmail draft');
  assert.equal(tables.work_items.length, 1);
  assert.equal(tables.work_items[0].due_at, '2026-10-09T21:00:00Z');
  assert.equal(tables.work_items[0].source_id, 'm1#0');
  assert.equal(calls.ai.length, 2, 'one sorting call and one writing call');
  // Sorting uses the cheap model with no thinking, writing uses Flash.
  const again = await runEmailTriage(fakeDb(tables), { days: 3, today: '2026-10-07' });
  assert.equal(again.read, 0, 'an email is read once');
});

test('an email Maya already answered in Gmail is closed, with no draft and no task', async () => {
  const calls = gmailAndAi({ repliedAlready: true });
  const tables = {};
  await runEmailTriage(fakeDb(tables), { days: 3, today: '2026-10-07' });
  assert.equal(tables.command_email_triage[0].status, 'done');
  assert.equal(calls.drafts, 0);
  assert.equal((tables.work_items || []).length, 0);
});

test('a to-do becomes a task with no reply drafted', async () => {
  const calls = gmailAndAi({ kind: 'todo' });
  const tables = {};
  await runEmailTriage(fakeDb(tables), { days: 3, today: '2026-10-07' });
  assert.equal(tables.command_email_triage[0].kind, 'todo');
  assert.equal(calls.drafts, 0);
  assert.equal(tables.work_items.length, 1);
  assert.equal(calls.ai.length, 1);
});

test('one email with several things: each gets its own item, events stay out of Work, and a past deadline is marked missed', async () => {
  // Shaped like the Conscious Venture Lab email: an event tomorrow, an optional invite, and an application that already closed.
  gmailAndAi({ kind: 'todo', items: [
    { type: 'event', title: 'Pre-accelerator first session', date: '2026-10-08', time: '11:45', place: 'Spark Co-Working, 8 Market Pl, Baltimore', details: 'Session starts at 12. Parking at 15 S. Frederick St, $12 before 8:30 AM.' },
    { type: 'optional', title: 'Cursive Technology celebration (RSVP)', date: '2026-10-08', time: '17:00', end_time: '18:30', place: 'Lenie Lodge & Beer Garden', details: '' },
    { type: 'todo', title: 'Apply to Baltipreneurs Accelerator', date: '2026-10-05', details: 'Loyola, runs December through March.' },
  ] });
  const tables = {};
  await runEmailTriage(fakeDb(tables), { days: 3, today: '2026-10-07' });
  const row = tables.command_email_triage[0];
  assert.equal(row.kind, 'todo');
  assert.deepEqual(row.items.map((i) => i.type), ['event', 'optional', 'missed'], 'a deadline before today becomes missed');
  assert.equal((tables.work_items || []).length, 0, 'events go to Heads up, not Work; missed and optional are not tasks either');
});

test('a LinkedIn message notice becomes a "Reply on LinkedIn" to-do with no email draft', async () => {
  const { platformOf, noEmailReplies } = await import('../api/_lib/email-triage.js');
  const meta = { sender: { name: 'Anthony Stroman via LinkedIn', email: 'messages-noreply@linkedin.com' } };
  assert.equal(platformOf(meta), 'LinkedIn');
  assert.equal(platformOf({ sender: { name: 'Maya Lee', email: 'maya@client.com' } }), null);
  const out = noEmailReplies({ kind: 'reply', items: [{ type: 'reply', title: 'Reply to Anthony Stroman' }] }, 'LinkedIn');
  assert.equal(out.kind, 'todo');
  assert.equal(out.items[0].type, 'todo');
  assert.match(out.items[0].title, /^Reply on LinkedIn: Anthony Stroman/);
});
