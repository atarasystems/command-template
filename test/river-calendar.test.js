import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { createCommandSession } from '../api/_lib/auth.js';
import { eventOverlaps, extractCalendarCandidates, parseAbsoluteDate, resolveEmailDate } from '../api/_lib/calendar-email.js';
import { gmailBody } from '../api/_lib/gmail.js';
import { createPendingCalendarAction, createPendingEmailRead, createPendingSenderResolution, verifyPendingCalendarAction, verifyPendingEmailRead, verifyPendingSenderResolution } from '../api/_lib/river-calendar-action.js';
import candidateHandler from '../api/gmail/calendar-candidates.js';
import { senderAlternatives, senderSimilarity } from '../api/gmail/calendar-candidates.js';
import createEventHandler from '../api/create-event.js';
import approveCalendarHandler from '../api/calendar/river-approve.js';
import readEmailHandler from '../api/gmail/read.js';
import riverHandler from '../api/river.js';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sessionSecret = 'river-calendar-test-secret-with-at-least-thirty-two-characters';

function response() {
  return { statusCode: 200, payload: undefined, headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; }, end() {} };
}

function request(body = {}) {
  const token = createCommandSession();
  return { method: 'POST', body, headers: { cookie: `atara_command_session=${token}` } };
}

test.beforeEach(() => { process.env.COMMAND_SESSION_SECRET = sessionSecret; });
test.after(() => { delete process.env.COMMAND_SESSION_SECRET; });

test('email dates resolve against received_at in Eastern time', () => {
  assert.equal(resolveEmailDate('tomorrow', '2026-08-25T20:00:00Z'), '2026-08-26');
  assert.equal(resolveEmailDate('tomorrow', '2026-08-26T03:30:00Z'), '2026-08-26');
  assert.equal(resolveEmailDate('Friday', '2026-08-27T16:00:00Z'), '2026-08-28');
  assert.equal(parseAbsoluteDate('September 8, 2026', '2026-09-02T12:00:00Z'), '2026-09-08');
});

test('calendar extraction handles one event, multiple events, deadlines, links, and date-only items', () => {
  const candidates = extractCalendarCandidates({ subject: 'Tiffany dates', received_at: '2026-09-02T16:00:00Z', body: 'AI Pitch Competition, September 8, 2026 at 4:00 PM. https://zoom.us/j/123\nFollow-up Call, September 12 at 10:30 AM\nApplication deadline September 15.' });
  assert.equal(candidates.length, 3);
  assert.equal(candidates[0].date, '2026-09-08');
  assert.equal(candidates[0].start_time, '16:00');
  assert.equal(candidates[0].meeting_url, 'https://zoom.us/j/123');
  assert.equal(candidates[1].date, '2026-09-12');
  assert.equal(candidates[2].deadline, true);
  assert.equal(candidates[2].all_day, true);
});

test('relative dates use the old email date and quoted duplicates are suppressed', () => {
  const candidates = extractCalendarCandidates({ subject: 'Events', received_at: '2026-08-25T16:00:00Z', body: 'Training tomorrow at 3 PM\n> Training tomorrow at 3 PM' });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].date, '2026-08-26');
  assert.equal(candidates[0].start_time, '15:00');
});

test('ambiguous reference dates are excluded and missing time does not invent a time', () => {
  const candidates = extractCalendarCandidates({ subject: 'Availability', received_at: '2026-09-02T16:00:00Z', body: 'I am available after September 10.\nThe program ran from August 1-20.\nConference September 12.' });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].date, '2026-09-12');
  assert.equal(candidates[0].start_time, null);
  assert.equal(candidates[0].all_day, true);
});

test('calendar duplicate detection uses date, approximate time, and title', () => {
  const candidate = { title: 'AI Pitch Competition', date: '2026-09-08', start_time: '16:00', all_day: false };
  assert.equal(eventOverlaps(candidate, { title: 'AI Pitch Competition', start: '2026-09-08T20:00:00Z', allDay: false }), true);
  assert.equal(eventOverlaps(candidate, { title: 'Other meeting', start: '2026-09-08T20:00:00Z', allDay: false }), false);
});

test('candidate preparation is authenticated and read-only', async () => {
  const originalFetch = global.fetch;
  const old = { id: process.env.GMAIL_CLIENT_ID, secret: process.env.GMAIL_CLIENT_SECRET, refresh: process.env.GMAIL_REFRESH_TOKEN };
  Object.assign(process.env, { GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh' });
  let mutations = 0;
  const metadata = { id: 'm1', threadId: 't1', snippet: 'Tomorrow at 3 PM', internalDate: String(Date.parse('2026-09-02T16:00:00Z')), payload: { headers: [{ name: 'From', value: 'Tiffany <tiffany@example.com>' }, { name: 'Subject', value: 'Training tomorrow' }, { name: 'Date', value: 'Wed, 02 Sep 2026 12:00:00 -0400' }], body: {} } };
  global.fetch = async (url, options = {}) => {
    if (options.method === 'POST' && String(url).includes('gmail.googleapis.com')) mutations += 1;
    if (String(url).includes('oauth2')) return { ok: true, async json() { return { access_token: 'token' }; } };
    if (String(url).includes('/messages?')) return { ok: true, async json() { return { messages: [{ id: 'm1' }] }; } };
    if (String(url).includes('/messages/m1')) return { ok: true, json: async () => metadata };
    return { ok: true, async json() { return { id: 'm1', threadId: 't1', payload: { headers: [] }, internalDate: '0' }; } };
  };
  try {
    const res = response(); await candidateHandler(request({ sender_query: 'Tiffany', latest: true }), res);
    assert.equal(res.statusCode, 200); assert.equal(res.payload.data.status, 'ready'); assert.equal(res.payload.data.candidates.length, 1); assert.equal(mutations, 0);
  } finally { global.fetch = originalFetch; for (const [key, value] of Object.entries({ GMAIL_CLIENT_ID: old.id, GMAIL_CLIENT_SECRET: old.secret, GMAIL_REFRESH_TOKEN: old.refresh })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test('candidate preparation does not guess among multiple emails or invent a match', async () => {
  const originalFetch = global.fetch;
  const old = { id: process.env.GMAIL_CLIENT_ID, secret: process.env.GMAIL_CLIENT_SECRET, refresh: process.env.GMAIL_REFRESH_TOKEN };
  Object.assign(process.env, { GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh' });
  global.fetch = async (url) => {
    if (String(url).includes('oauth2')) return { ok: true, async json() { return { access_token: 'token' }; } };
    if (String(url).includes('/messages?')) return { ok: true, async json() { return { messages: [{ id: 'm1' }, { id: 'm2' }] }; } };
    return { ok: true, async json() { return { id: String(url).includes('m1') ? 'm1' : 'm2', threadId: 't', payload: { headers: [{ name: 'From', value: 'Tiffany <tiffany@example.com>' }, { name: 'Subject', value: 'Date options' }, { name: 'Date', value: 'Wed, 02 Sep 2026 12:00:00 -0400' }] }, internalDate: String(Date.parse('2026-09-02T16:00:00Z')) }; } };
  };
  try {
    const choice = response(); await candidateHandler(request({ sender_query: 'Tiffany' }), choice); assert.equal(choice.payload.data.status, 'choose_email'); assert.equal(choice.payload.data.messages.length, 2); assert.equal(choice.payload.data.messages[0].message_id, undefined);
    const none = response(); global.fetch = async (url) => String(url).includes('oauth2') ? { ok: true, async json() { return { access_token: 'token' }; } } : { ok: true, async json() { return { messages: [] }; } }; await candidateHandler(request({ sender_query: 'Nobody', latest: true }), none); assert.equal(none.payload.data.status, 'no_match');
  } finally { global.fetch = originalFetch; for (const [key, value] of Object.entries({ GMAIL_CLIENT_ID: old.id, GMAIL_CLIENT_SECRET: old.secret, GMAIL_REFRESH_TOKEN: old.refresh })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test('sender resolution accepts an exact name without fuzzy substitution', async () => {
  assert.ok(senderSimilarity('Gillian Krug', 'Gillian Krug') > 0.99);
  assert.deepEqual(senderAlternatives('Gillian Krug', [{ sender: { name: 'Gillian Krug', email: 'gillian@example.com' } }]), [{ sender: 'Gillian Krug', score: 1 }]);
});

test('sender typo proposes one conservative close match before reading the email', async () => {
  const originalFetch = global.fetch;
  const old = { id: process.env.GMAIL_CLIENT_ID, secret: process.env.GMAIL_CLIENT_SECRET, refresh: process.env.GMAIL_REFRESH_TOKEN };
  Object.assign(process.env, { GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh' });
  let fullReads = 0;
  global.fetch = async (url) => {
    const value = String(url);
    if (value.includes('oauth2')) return { ok: true, async json() { return { access_token: 'token' }; } };
    if (value.includes('/messages?')) {
      if (value.includes('Jillian')) return { ok: true, async json() { return { messages: [] }; } };
      return { ok: true, async json() { return { messages: [{ id: 'gillian-1' }] }; } };
    }
    if (value.includes('format=full')) fullReads += 1;
    return { ok: true, async json() { return { id: 'gillian-1', threadId: 'thread-1', internalDate: String(Date.parse('2026-09-02T16:00:00Z')), payload: { headers: [{ name: 'From', value: 'Gillian Krug <gillian@example.com>' }, { name: 'Subject', value: 'Dates' }, { name: 'Date', value: 'Wed, 02 Sep 2026 12:00:00 -0400' }] } }; } };
  };
  try {
    const res = response();
    await candidateHandler(request({ sender_query: 'Jillian Krug', latest: true }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.payload.data.status, 'confirm_sender');
    assert.deepEqual(res.payload.data.sender_candidates, [{ sender: 'Gillian Krug' }]);
    assert.equal(fullReads, 0);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries({ GMAIL_CLIENT_ID: old.id, GMAIL_CLIENT_SECRET: old.secret, GMAIL_REFRESH_TOKEN: old.refresh })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('confirmed corrected sender continues lookup and exact email lookup still works', async () => {
  const originalFetch = global.fetch;
  const old = { id: process.env.GMAIL_CLIENT_ID, secret: process.env.GMAIL_CLIENT_SECRET, refresh: process.env.GMAIL_REFRESH_TOKEN };
  Object.assign(process.env, { GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh' });
  let bodyReads = 0;
  global.fetch = async (url) => {
    const value = String(url);
    if (value.includes('oauth2')) return { ok: true, async json() { return { access_token: 'token' }; } };
    if (value.includes('/messages?')) return { ok: true, async json() { return { messages: [{ id: 'gillian-1' }] }; } };
    if (value.includes('format=full')) { bodyReads += 1; return { ok: true, async json() { return { id: 'gillian-1', threadId: 'thread-1', payload: { headers: [{ name: 'From', value: 'Gillian Krug <gillian@example.com>' }, { name: 'Subject', value: 'Meeting tomorrow at 3 PM' }, { name: 'Date', value: 'Wed, 02 Sep 2026 12:00:00 -0400' }], parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('Meeting tomorrow at 3 PM').toString('base64url') } }] }, internalDate: String(Date.parse('2026-09-02T16:00:00Z')) }; } }; }
    return { ok: true, async json() { return { id: 'gillian-1', threadId: 'thread-1', internalDate: String(Date.parse('2026-09-02T16:00:00Z')), payload: { headers: [{ name: 'From', value: 'Gillian Krug <gillian@example.com>' }, { name: 'Subject', value: 'Meeting tomorrow at 3 PM' }, { name: 'Date', value: 'Wed, 02 Sep 2026 12:00:00 -0400' }] } }; } };
  };
  try {
    const correctedRequest = request({ sender_query: 'Jillian Krug', latest: true });
    const senderCandidates = [{ sender: 'Gillian Krug' }];
    const senderToken = createPendingSenderResolution(correctedRequest, 'Jillian Krug', senderCandidates);
    assert.ok(verifyPendingSenderResolution(correctedRequest, senderToken));
    const corrected = response();
    await candidateHandler({ ...correctedRequest, body: { sender_query: 'Jillian Krug', sender_resolution_token: senderToken, sender_candidate_index: 0, latest: true } }, corrected);
    assert.equal(corrected.payload.data.status, 'ready');
    assert.equal(bodyReads, 1);
    const exactEmail = response();
    await candidateHandler(request({ sender_query: 'gillian@example.com', latest: true }), exactEmail);
    assert.equal(exactEmail.payload.data.status, 'ready');
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries({ GMAIL_CLIENT_ID: old.id, GMAIL_CLIENT_SECRET: old.secret, GMAIL_REFRESH_TOKEN: old.refresh })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('multiple close sender matches require a choice and no plausible match remains no_match', async () => {
  const originalFetch = global.fetch;
  const old = { id: process.env.GMAIL_CLIENT_ID, secret: process.env.GMAIL_CLIENT_SECRET, refresh: process.env.GMAIL_REFRESH_TOKEN };
  Object.assign(process.env, { GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh' });
  global.fetch = async (url) => {
    const value = String(url);
    if (value.includes('oauth2')) return { ok: true, async json() { return { access_token: 'token' }; } };
    if (value.includes('Jillian') || value.includes('Nobody')) return { ok: true, async json() { return { messages: [] }; } };
    if (value.toLowerCase().includes('krug')) return { ok: true, async json() { return { messages: [{ id: 'gillian-1' }, { id: 'jill-1' }] }; } };
    const isJill = value.includes('jill-1');
    return { ok: true, async json() { return { id: isJill ? 'jill-1' : 'gillian-1', threadId: 'thread', internalDate: String(Date.parse('2026-09-02T16:00:00Z')), payload: { headers: [{ name: 'From', value: (isJill ? 'Jill Kruger <jill@example.com>' : 'Gillian Krug <gillian@example.com>') }, { name: 'Subject', value: 'Dates' }, { name: 'Date', value: 'Wed, 02 Sep 2026 12:00:00 -0400' }] } }; } };
  };
  try {
    const many = response(); await candidateHandler(request({ sender_query: 'Jillian Krug', latest: true }), many);
    assert.equal(many.payload.data.status, 'choose_sender');
    assert.deepEqual(many.payload.data.sender_candidates.map((candidate) => candidate.sender), ['Gillian Krug', 'Jill Kruger']);
    const none = response(); await candidateHandler(request({ sender_query: 'Nobody', latest: true }), none);
    assert.equal(none.payload.data.status, 'no_match');
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries({ GMAIL_CLIENT_ID: old.id, GMAIL_CLIENT_SECRET: old.secret, GMAIL_REFRESH_TOKEN: old.refresh })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('sender correction UI requires confirmation and preserves calendar approval boundaries', () => {
  assert.match(html, /riverSenderCorrectionPending/);
  assert.match(html, /result\.status==='confirm_sender'\|\|result\.status==='choose_sender'/);
  assert.match(html, /sender_resolution_token:\s*pending\.token/);
  assert.match(html, /sender_candidate_index:\s*decision\.index/);
  assert.match(html, /riverSenderCorrectionParse/);
  assert.match(html, /riverCalendarPending/);
  assert.match(html, /api\/calendar\/river-approve/);
  assert.doesNotMatch(html, /sender_candidates[\s\S]{0,500}(delete|trash|modify)/i);
});

test('subject search finds exact and normalized partial matches without Gmail mutation', async () => {
  const originalFetch = global.fetch;
  const old = { id: process.env.GMAIL_CLIENT_ID, secret: process.env.GMAIL_CLIENT_SECRET, refresh: process.env.GMAIL_REFRESH_TOKEN };
  Object.assign(process.env, { GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh' });
  let mutations = 0;
  global.fetch = async (url, options = {}) => {
    const value = String(url);
    if (options.method === 'POST' && value.includes('gmail.googleapis.com')) mutations += 1;
    if (value.includes('oauth2')) return { ok: true, async json() { return { access_token: 'token' }; } };
    if (value.includes('/messages?')) {
      const lower = value.toLowerCase();
      const isPartial = lower.includes('subject%3aconscious+subject%3aventure+subject%3alab');
      return { ok: true, async json() { return { messages: lower.includes('subject%3a%22conscious+venture+lab%22') ? [{ id: 'exact-1' }] : (isPartial ? [{ id: 'partial-1' }] : []) }; } };
    }
    const id = value.includes('partial-1') ? 'partial-1' : 'exact-1';
    return { ok: true, async json() { return { id, threadId: 'thread-' + id, internalDate: String(Date.parse('2026-09-02T16:00:00Z')), payload: { headers: [{ name: 'From', value: 'Sender <sender@example.com>' }, { name: 'Subject', value: id === 'partial-1' ? 'Conscious Venture Lab Fall Schedule' : 'Conscious Venture Lab' }, { name: 'Date', value: 'Wed, 02 Sep 2026 12:00:00 -0400' }], parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('Conference September 8 at 4 PM').toString('base64url') } }] } }; } };
  };
  try {
    const exact = response(); await candidateHandler(request({ subject_query: 'Conscious Venture Lab', latest: true }), exact);
    assert.equal(exact.payload.data.status, 'ready');
    const partial = response(); await candidateHandler(request({ subject_query: 'Conscious Venture Lab Schedule', latest: true }), partial);
    assert.equal(partial.payload.data.status, 'ready');
    assert.equal(mutations, 0);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries({ GMAIL_CLIENT_ID: old.id, GMAIL_CLIENT_SECRET: old.secret, GMAIL_REFRESH_TOKEN: old.refresh })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('subject search supports sender context, latest selection, and ambiguity choices', async () => {
  const originalFetch = global.fetch;
  const old = { id: process.env.GMAIL_CLIENT_ID, secret: process.env.GMAIL_CLIENT_SECRET, refresh: process.env.GMAIL_REFRESH_TOKEN };
  Object.assign(process.env, { GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh' });
  const requested = [];
  global.fetch = async (url) => {
    const value = String(url); requested.push(value);
    if (value.includes('oauth2')) return { ok: true, async json() { return { access_token: 'token' }; } };
    if (value.includes('/messages?')) return { ok: true, async json() { return { messages: [{ id: 'old' }, { id: 'new' }] }; } };
    const id = value.includes('/new') ? 'new' : 'old';
    return { ok: true, async json() { return { id, threadId: 'thread-' + id, internalDate: String(Date.parse(id === 'new' ? '2026-09-02T16:00:00Z' : '2026-08-30T16:00:00Z')), payload: { headers: [{ name: 'From', value: 'Gillian Krug <gillian@example.com>' }, { name: 'Subject', value: 'Conscious Venture Lab' }, { name: 'Date', value: id === 'new' ? 'Wed, 02 Sep 2026 12:00:00 -0400' : 'Sun, 30 Aug 2026 12:00:00 -0400' }], parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('Conference September 8 at 4 PM').toString('base64url') } }] } }; } };
  };
  try {
    const latest = response(); await candidateHandler(request({ sender_query: 'Gillian', subject_query: 'Conscious Venture Lab', latest: true }), latest);
    assert.equal(latest.payload.data.status, 'ready');
    assert.ok(requested.some((url) => url.includes('from%3AGillian') && url.includes('subject%3A%22Conscious+Venture+Lab%22')));
    const choice = response(); await candidateHandler(request({ subject_query: 'Conscious Venture Lab' }), choice);
    assert.equal(choice.payload.data.status, 'choose_email');
    assert.equal(choice.payload.data.messages[0].message_id, undefined);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries({ GMAIL_CLIENT_ID: old.id, GMAIL_CLIENT_SECRET: old.secret, GMAIL_REFRESH_TOKEN: old.refresh })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('River retains subject/date follow-up context and keeps normal Gmail search broader than Inbox', () => {
  assert.match(html, /riverEmailSearchPending/);
  assert.match(html, /riverEmailFollowupParse/);
  assert.match(html, /subject_query/);
  assert.match(html, /date_hint: 'last week'/);
  assert.match(html, /executeRiverCalendarRequest\(JSON\.stringify\(Object\.assign\(\{\}, emailSearch\.request, emailFollowup\)\)/);
  assert.doesNotMatch(html, /searchMessages\([^\n]+in:inbox/);
  assert.doesNotMatch(html, /subject_query[\s\S]{0,300}(trash|spam|promotions)/i);
});

test('Gmail body reader supports plain text, HTML, multipart content, links, and attachments', async () => {
  const originalFetch = global.fetch;
  const plain = Buffer.from('Classes meet Thursdays from 6:00–8:00 PM\nhttps://zoom.us/j/123\n> Classes meet Thursdays from 6:00–8:00 PM\n> Old quoted detail').toString('base64url');
  const html = Buffer.from('<p>Classes meet <strong>6:00–8:00 PM</strong>.</p><script>bad()</script><a href="https://zoom.us/j/123">Join</a>').toString('base64url');
  let mode = 'plain';
  global.fetch = async () => ({ ok: true, async json() { return mode === 'plain' ? { id: 'm1', threadId: 't1', payload: { parts: [{ mimeType: 'text/plain', body: { data: plain } }, { filename: 'agenda.pdf', mimeType: 'application/pdf', body: {} }] } } : { id: 'm2', threadId: 't2', payload: { mimeType: 'text/html', body: { data: html } } }; } });
  try {
    const text = await gmailBody('token', 'm1');
    assert.match(text.body, /6:00/); assert.match(text.body, /zoom\.us/); assert.doesNotMatch(text.body, /> Classes meet/); assert.match(text.body, /> Old quoted detail/); assert.equal(text.attachments[0].filename, 'agenda.pdf');
    mode = 'html'; const rendered = await gmailBody('token', 'm2');
    assert.match(rendered.body, /6:00/); assert.match(rendered.body, /https:\/\/zoom\.us\/j\/123/); assert.doesNotMatch(rendered.body, /<script|bad\(\)/);
  } finally { global.fetch = originalFetch; }
});

test('resolved email read is authenticated, bounded, and returns content without Gmail mutation', async () => {
  const originalFetch = global.fetch;
  const old = { id: process.env.GMAIL_CLIENT_ID, secret: process.env.GMAIL_CLIENT_SECRET, refresh: process.env.GMAIL_REFRESH_TOKEN };
  Object.assign(process.env, { GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh' });
  let mutations = 0;
  const req = request(); const token = createPendingEmailRead(req, { message_id: 'm1', thread_id: 't1', sender: 'Gillian Krug', subject: 'Conscious Venture Lab', received_at: '2026-09-02T16:00:00Z' });
  global.fetch = async (url, options = {}) => {
    const value = String(url); if (options.method === 'POST' && value.includes('gmail.googleapis.com')) mutations += 1;
    if (value.includes('oauth2')) return { ok: true, async json() { return { access_token: 'token' }; } };
    return { ok: true, async json() { return { id: 'm1', threadId: 't1', payload: { parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('Classes meet Thursdays from 6:00–8:00 PM. https://zoom.us/j/123').toString('base64url') } }] } }; } };
  };
  try {
    const res = response(); await readEmailHandler({ ...req, body: { email_read_token: token } }, res);
    assert.equal(res.statusCode, 200); assert.equal(res.payload.data.email.subject, 'Conscious Venture Lab'); assert.match(res.payload.data.body, /6:00/); assert.match(res.payload.data.body, /zoom\.us/); assert.equal(res.payload.data.message_id, undefined); assert.equal(mutations, 0);
    const unauthorized = response(); await readEmailHandler({ method: 'POST', body: { email_read_token: token }, headers: {} }, unauthorized); assert.equal(unauthorized.statusCode, 401);
  } finally { global.fetch = originalFetch; for (const [key, value] of Object.entries({ GMAIL_CLIENT_ID: old.id, GMAIL_CLIENT_SECRET: old.secret, GMAIL_REFRESH_TOKEN: old.refresh })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test('River email reading uses the resolved follow-up context and preserves Calendar approval boundaries', () => {
  assert.match(html, /Personal Assistant\s+&nbsp;\|&nbsp;\s+<span data-company-name>/);
  assert.doesNotMatch(html, /Hi Solei\. I am River, your AI chief of staff/);
  assert.match(html, /RIVER_EMAIL_REQUEST/);
  assert.match(html, /riverEmailReadPending/);
  assert.match(html, /riverEmailReadFollowupParse/);
  assert.match(html, /fetch\('\/api\/gmail\/read'/);
  assert.match(html, /Command email read result/);
  assert.match(html, /calendar_candidates/);
  assert.match(html, /riverCalendarPending/);
  assert.match(html, /api\/calendar\/river-approve/);
  assert.match(html, /riverEmailReadPending=\{token:result\.email_read_token/);
  assert.doesNotMatch(html, /riverEmailReadToolResult[\s\S]{0,1000}message_id/);
});

test('calendar creation requires Command authentication and supports approved all-day writes', async () => {
  const originalFetch = global.fetch;
  const old = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET, refresh: process.env.GOOGLE_REFRESH_TOKEN };
  Object.assign(process.env, { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'refresh' });
  let createdBody;
  global.fetch = async (url, options = {}) => String(url).includes('oauth2') ? { ok: true, async json() { return { access_token: 'token' }; } } : { ok: true, async text() { createdBody = JSON.parse(options.body); return JSON.stringify({ id: 'event-1' }); }, async json() { return { id: 'event-1' }; } };
  try {
    const unauthorized = response(); await createEventHandler({ method: 'POST', body: { title: 'Unapproved' }, headers: {} }, unauthorized); assert.equal(unauthorized.statusCode, 401);
    const approved = response(); await createEventHandler(request({ title: 'Deadline', startISO: '2026-09-08', endISO: '2026-09-09', allDay: true }), approved); assert.equal(approved.statusCode, 200); assert.deepEqual(createdBody.start, { date: '2026-09-08' }); assert.deepEqual(createdBody.end, { date: '2026-09-09' });
  } finally { global.fetch = originalFetch; for (const [key, value] of Object.entries({ GOOGLE_CLIENT_ID: old.id, GOOGLE_CLIENT_SECRET: old.secret, GOOGLE_REFRESH_TOKEN: old.refresh })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test('River calendar UI prepares before write and only writes from explicit selection', () => {
  assert.match(html, /id="talk-to-river-btn"[^>]*type="button"/);
  assert.doesNotMatch(html, /id="talk-to-river-btn"[^>]*onclick=/);
  assert.match(html, /function openRiverPanel\(\)/);
  assert.match(html, /function bindCommandHeaderControls\(\)/);
  assert.match(html, /\['talk-to-river-btn', openRiverPanel\]/);
  assert.match(html, /openRiverPanel[\s\S]*river-panel[\s\S]*river-overlay/);
  assert.match(html, /id="command-navigate-btn"[^>]*aria-expanded="false"/);
  assert.match(html, /\['command-navigate-btn', toggleMobileNav\]/);
  assert.match(html, /RIVER_CALENDAR_REQUEST/);
  assert.match(html, /executeRiverCalendarRequest/);
  assert.match(html, /Add selected/);
  assert.match(html, /fetch\('\/api\/calendar\/river-approve'/);
  assert.match(html, /riverCalendarPreview/);
  assert.match(html, /riverCalendarPending/);
  assert.match(html, /selected_indexes/);
  assert.match(html, /allow_duplicate_indexes/);
  assert.match(html, /add the first one/);
  assert.match(html, /closePanel\('river-panel'\)/);
  assert.match(html, /founderDetailState\s*=\s*'full-command'/);
  assert.doesNotMatch(html.slice(html.indexOf('function executeRiverCalendarRequest'), html.indexOf('async function executeRiverAction')), /delete|trash|reply|send-email|unsubscribe|block/i);
});

test('River tool-routing prose stays internal and only the continuation is founder-facing', () => {
  const sendSource = html.slice(html.indexOf('async function riverSend'), html.indexOf('function appendRiverMessage'));
  assert.match(sendSource, /const calendarRequestMatch = reply\.match/);
  assert.match(sendSource, /riverMessages\.push\(\{ role: 'assistant', content: reply \}\);[\s\S]*appendRiverMessage\('river', (?:emailRequestMatch \? 'River is reading the email\.\.\.' : )?'River is checking Gmail\.\.\.'/);
  assert.match(sendSource, /await executeRiverCalendarRequest\(\(calendarRequestMatch \|\| emailRequestMatch\)\[1\]\.trim\(\), toolLoadingId\)/);
  assert.match(sendSource, /else \{[\s\S]*appendRiverMessage\('river', reply\);/);
  assert.doesNotMatch(sendSource, /appendRiverMessage\('river', reply\);[\s\S]*calendarRequestMatch/);
  const executionSource = html.slice(html.indexOf('async function executeRiverCalendarRequest'), html.indexOf('async function executeRiverAction'));
  assert.match(executionSource, /riverContinueAfterCalendarPreparation/);
  assert.doesNotMatch(executionSource, /appendActionStatus\(bubble/);
  assert.match(executionSource, /riverRemoveToolLoading/);
  assert.match(executionSource, /No calendar items were prepared/);
  assert.match(html, /replace\(\/<RIVER_CALENDAR_REQUEST>/);
});

test('one River request completes Gmail preparation and returns the result before approval', async () => {
  const originalFetch = global.fetch;
  const old = { apiKey: process.env.ANTHROPIC_API_KEY, gmailId: process.env.GMAIL_CLIENT_ID, gmailSecret: process.env.GMAIL_CLIENT_SECRET, gmailRefresh: process.env.GMAIL_REFRESH_TOKEN };
  Object.assign(process.env, { ANTHROPIC_API_KEY: 'anthropic-key', GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret', GMAIL_REFRESH_TOKEN: 'refresh' });
  const calls = [];
  let anthropicCall = 0;
  const metadata = { id: 'm1', threadId: 't1', internalDate: String(Date.parse('2026-09-02T16:00:00Z')), payload: { headers: [{ name: 'From', value: 'Tiffany <tiffany@example.com>' }, { name: 'Subject', value: 'September dates' }, { name: 'Date', value: 'Wed, 02 Sep 2026 12:00:00 -0400' }], parts: [{ mimeType: 'text/plain', body: { data: Buffer.from('AI Pitch Competition, September 8, 2026 at 4:00 PM').toString('base64url') } }] } };
  global.fetch = async (url, options = {}) => {
    calls.push(String(url));
    if (String(url).includes('api.anthropic.com')) {
      anthropicCall += 1;
      const body = JSON.parse(options.body);
      assert.ok(anthropicCall <= 2);
      if (anthropicCall === 1) assert.match(body.messages.at(-1).content, /Find the latest email from Tiffany/);
      if (anthropicCall === 2) {
        assert.match(body.messages.at(-1).content, /Command calendar preparation result/);
        assert.doesNotMatch(body.messages.at(-1).content, /action_token/);
      }
      const text = anthropicCall === 1
        ? 'I will look for Tiffany’s latest email and prepare the dates.\n<RIVER_CALENDAR_REQUEST>\n{"sender_query":"Tiffany","latest":true}\n</RIVER_CALENDAR_REQUEST>'
        : 'I found one calendar item in Tiffany’s email and prepared it for your approval.';
      return { ok: true, async json() { return { content: [{ type: 'text', text }] }; } };
    }
    if (String(url).includes('oauth2')) return { ok: true, async json() { return { access_token: 'gmail-token' }; } };
    if (String(url).includes('/messages?')) return { ok: true, async json() { return { messages: [{ id: 'm1' }] }; } };
    if (String(url).includes('/messages/m1')) return { ok: true, async json() { return metadata; } };
    throw new Error(`Unexpected request: ${url}`);
  };
  const riverResponse = response();
  const sessionRequest = request({ messages: [{ role: 'user', content: 'Find the latest email from Tiffany and add the dates to my calendar.' }], dashboardContext: '' });
  try {
    await riverHandler(sessionRequest, riverResponse);
    assert.equal(riverResponse.statusCode, 200);
    const firstReply = riverResponse.payload.text;
    assert.match(firstReply, /RIVER_CALENDAR_REQUEST/);
    const marker = firstReply.match(/<RIVER_CALENDAR_REQUEST>([\s\S]*?)<\/RIVER_CALENDAR_REQUEST>/)[1].trim();
    const candidateResponse = response();
    await candidateHandler(request({ sender_query: 'Tiffany', latest: true }), candidateResponse);
    assert.equal(candidateResponse.payload.data.status, 'ready');
    assert.equal(candidateResponse.payload.data.candidates[0].start_time, '16:00');
    const continuationResponse = response();
    await riverHandler({ ...sessionRequest, body: { messages: [{ role: 'user', content: 'Find the latest email from Tiffany and add the dates to my calendar.' }, { role: 'assistant', content: firstReply }, { role: 'user', content: '[Command calendar preparation result]\n' + JSON.stringify({ status: candidateResponse.payload.data.status, candidates: candidateResponse.payload.data.candidates.map(({ title, date, start_time, end_time, all_day }) => ({ title, date, start_time, end_time, all_day })) }) }], dashboardContext: '' } }, continuationResponse);
    assert.equal(continuationResponse.statusCode, 200);
    assert.match(continuationResponse.payload.text, /prepared|calendar item/i);
    assert.ok(calls.filter((url) => url.includes('api.anthropic.com')).length >= 2);
    assert.equal(calls.some((url) => url.includes('/api/calendar/river-approve')), false);
    assert.match(marker, /sender_query/);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries({ ANTHROPIC_API_KEY: old.apiKey, GMAIL_CLIENT_ID: old.gmailId, GMAIL_CLIENT_SECRET: old.gmailSecret, GMAIL_REFRESH_TOKEN: old.gmailRefresh })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test('River panel open state remains displayable in progressive home modes', () => {
  assert.match(html, /\.slide-panel \{[\s\S]*position: fixed;[\s\S]*right: -520px;/);
  assert.match(html, /\.slide-panel\.open \{ right: 0; \}/);
  assert.match(html, /#river-panel \{[^}]*display: flex;/);
  assert.match(html, /body\.low-capacity-mode main > :not\(#low-capacity-panel\):not\(\.slide-panel\) \{ display:none !important; \}/);
  assert.match(html, /body\.progressive-home-mode main > :not\(#low-capacity-panel\):not\(#founder-home-panel\):not\(\.slide-panel\) \{ display:none !important; \}/);
  assert.match(html, /body\.progressive-home-detail main > :not\(#low-capacity-panel\):not\(#founder-home-panel\):not\(\.founder-active-detail\):not\(\.slide-panel\) \{ display:none !important; \}/);
  assert.match(html, /id="river-overlay"/);
  assert.match(html, /closePanel\('river-panel'\)/);
  assert.match(html, /\['talk-to-river-btn', openRiverPanel\]/);
});

test('pending calendar action is signed, session-bound, expires, and cannot be replayed by another session', () => {
  const first = request();
  const token = createPendingCalendarAction(first, [{ title: 'Meeting', date: '2026-09-08', start_time: '16:00', end_time: null, all_day: false, duplicate: false }]);
  assert.ok(verifyPendingCalendarAction(first, token));
  assert.equal(verifyPendingCalendarAction({ ...request(), headers: { cookie: `atara_command_session=${createCommandSession(Date.now() + 1000)}` } }, token), null);
  const originalNow = Date.now;
  try { Date.now = () => originalNow() + 16 * 60 * 1000; assert.equal(verifyPendingCalendarAction(first, token), null); } finally { Date.now = originalNow; }
});

test('sender confirmation is also session-bound, expires, and cannot accept an invalid index', () => {
  const first = request();
  const token = createPendingSenderResolution(first, 'Jillian Krug', [{ sender: 'Gillian Krug' }]);
  assert.deepEqual(verifyPendingSenderResolution(first, token)?.candidates, [{ sender: 'Gillian Krug' }]);
  assert.equal(verifyPendingSenderResolution({ ...request(), headers: { cookie: `atara_command_session=${createCommandSession(Date.now() + 1000)}` } }, token), null);
  const originalNow = Date.now;
  try { Date.now = () => originalNow() + 16 * 60 * 1000; assert.equal(verifyPendingSenderResolution(first, token), null); } finally { Date.now = originalNow; }
});

test('calendar approval writes only signed prepared selections and ignores replacement payloads', async () => {
  const originalFetch = global.fetch;
  Object.assign(process.env, { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'refresh' });
  const req = request();
  const candidates = [
    { title: 'First', date: '2026-09-08', start_time: '16:00', end_time: null, all_day: false, duplicate: false },
    { title: 'Second', date: '2026-09-09', start_time: null, end_time: null, all_day: true, duplicate: false },
    { title: 'Third', date: '2026-09-10', start_time: '10:00', end_time: '11:00', all_day: false, duplicate: false },
  ];
  const token = createPendingCalendarAction(req, candidates); const bodies = [];
  global.fetch = async (url, options = {}) => String(url).includes('oauth2') ? { ok: true, async json() { return { access_token: 'token' }; } } : options.method === 'GET' ? { ok: false, status: 404, async text() { return '{}'; } } : { ok: true, async text() { bodies.push(JSON.parse(options.body)); return JSON.stringify({ id: 'created' }); } };
  try {
    const res = response(); await approveCalendarHandler({ ...req, body: { action_token: token, selected_indexes: [0, 2], candidates: [{ title: 'ATTACKER' }] } }, res);
    assert.equal(res.statusCode, 200); assert.deepEqual(bodies.map((body) => body.summary), ['First', 'Third']); assert.equal(bodies.some((body) => body.summary === 'ATTACKER'), false);
  } finally { global.fetch = originalFetch; for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']) delete process.env[key]; }
});

test('duplicate candidates are skipped unless the approval explicitly overrides them', async () => {
  const originalFetch = global.fetch; Object.assign(process.env, { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'refresh' });
  const req = request(); const token = createPendingCalendarAction(req, [{ title: 'Existing', date: '2026-09-08', start_time: '16:00', end_time: null, all_day: false, duplicate: true }]); let creates = 0;
  global.fetch = async (url, options = {}) => String(url).includes('oauth2') ? { ok: true, async json() { return { access_token: 'token' }; } } : options.method === 'GET' ? { ok: false, status: 404, async text() { return '{}'; } } : { ok: true, async text() { creates += 1; return JSON.stringify({ id: 'event' }); } };
  try {
    const skipped = response(); await approveCalendarHandler({ ...req, body: { action_token: token, selected_indexes: [0] } }, skipped); assert.equal(skipped.statusCode, 409); assert.equal(creates, 0);
    const added = response(); await approveCalendarHandler({ ...req, body: { action_token: token, selected_indexes: [0], allow_duplicate_indexes: [0] } }, added); assert.equal(added.statusCode, 200); assert.equal(creates, 1);
  } finally { global.fetch = originalFetch; for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']) delete process.env[key]; }
});

test('approval stops on partial Calendar failure and replay uses deterministic event identity', async () => {
  const originalFetch = global.fetch; Object.assign(process.env, { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'refresh' });
  const req = request(); const token = createPendingCalendarAction(req, [{ title: 'First', date: '2026-09-08', start_time: '16:00', end_time: null, all_day: false, duplicate: false }, { title: 'Second', date: '2026-09-09', start_time: '16:00', end_time: null, all_day: false, duplicate: false }]); let calls = 0; const ids = [];
  const createdIds = new Set();
  global.fetch = async (url, options = {}) => {
    if (String(url).includes('oauth2')) return { ok: true, async json() { return { access_token: 'token' }; } };
    if (options.method === 'GET') { const id = String(url).split('/').pop(); return createdIds.has(id) ? { ok: true, async text() { return JSON.stringify({ id }); } } : { ok: false, status: 404, async text() { return '{}'; } }; }
    const body = JSON.parse(options.body); ids.push(body.id); calls += 1;
    if (calls === 1) { createdIds.add(body.id); return { ok: true, async text() { return JSON.stringify({ id: body.id }); } }; }
    if (calls === 2) return { ok: false, status: 500, async text() { return JSON.stringify({ error: { message: 'failure' } }); } };
    if (calls === 3) { createdIds.add(body.id); return { ok: true, async text() { return JSON.stringify({ id: body.id }); } }; }
    return { ok: false, status: 409, async text() { return JSON.stringify({ error: { message: 'already exists' } }); } };
  };
  try {
    const res = response(); await approveCalendarHandler({ ...req, body: { action_token: token, selected_indexes: [0, 1] } }, res); assert.equal(res.statusCode, 502); assert.equal(res.payload.data.created.length, 1); assert.equal(ids.length, 2);
    const retry = response(); await approveCalendarHandler({ ...req, body: { action_token: token, selected_indexes: [0, 1] } }, retry); assert.equal(retry.statusCode, 200); assert.equal(retry.payload.data.created.length, 1); assert.equal(retry.payload.data.already_handled.length, 1); assert.equal(ids.length, 3);
    const replay = response(); await approveCalendarHandler({ ...req, body: { action_token: token, selected_indexes: [0, 1] } }, replay); assert.equal(replay.statusCode, 200); assert.equal(replay.payload.data.created.length, 0); assert.equal(replay.payload.data.already_handled.length, 2); assert.equal(ids.length, 3);
  } finally { global.fetch = originalFetch; for (const key of ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN']) delete process.env[key]; }
});

test('calendar approval requires authentication and never calls Gmail', async () => {
  const originalFetch = global.fetch; let calls = 0; global.fetch = async () => { calls += 1; return { ok: true, async json() { return {}; } }; };
  try { const res = response(); await approveCalendarHandler({ method: 'POST', body: {}, headers: {} }, res); assert.equal(res.statusCode, 401); assert.equal(calls, 0); } finally { global.fetch = originalFetch; }
});
