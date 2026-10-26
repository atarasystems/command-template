import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import calendarHandler, { normalizedConferenceUrls, safeHttpUrl } from '../api/_routes/calendar.js';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function response() {
  return {
    statusCode: 200,
    payload: undefined,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.payload = value; return this; },
    end() { return this; },
  };
}

test('calendar API preserves existing fields and safely normalizes detail fields', async () => {
  const originalFetch = global.fetch;
  const oldEnv = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET, refresh: process.env.GOOGLE_REFRESH_TOKEN };
  Object.assign(process.env, { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'refresh' });
  global.fetch = async (url) => url.includes('oauth2')
    ? { ok: true, async json() { return { access_token: 'token' }; } }
    : { ok: true, async json() { return { items: [{ id: 'event-1', summary: 'Planning', start: { dateTime: '2026-08-28T15:00:00Z' }, end: { dateTime: '2026-08-28T16:00:00Z' }, colorId: '2', location: 'Room 1', description: 'Discuss roadmap', htmlLink: 'https://calendar.google.com/event/1', hangoutLink: 'https://meet.google.com/abc-defg-hij', conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://zoom.us/j/123' }, { entryPointType: 'phone', uri: 'tel:+15551234567' }] } }] }; } };
  try {
    process.env.COMMAND_SESSION_SECRET = process.env.COMMAND_SESSION_SECRET || 'test-session-secret';
    const { createCommandSession } = await import('../api/_routes/_lib/auth.js');
    const unauthenticated = response();
    await calendarHandler({ method: 'POST', headers: {}, body: { startISO: '2026-08-28T00:00:00Z', endISO: '2026-08-29T00:00:00Z' } }, unauthenticated);
    assert.equal(unauthenticated.statusCode, 401);
    const res = response();
    await calendarHandler({ method: 'POST', headers: { cookie: `atara_command_session=${createCommandSession()}` }, body: { startISO: '2026-08-28T00:00:00Z', endISO: '2026-08-29T00:00:00Z' } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload.events[0], {
      id: 'event-1', title: 'Planning', start: '2026-08-28T15:00:00Z', end: '2026-08-28T16:00:00Z', colorId: '2', allDay: false, isAtara: true,
      location: 'Room 1', description: 'Discuss roadmap', htmlLink: 'https://calendar.google.com/event/1', hangoutLink: 'https://meet.google.com/abc-defg-hij', conferenceUrls: ['https://zoom.us/j/123'],
    });
    assert.equal('conferenceData' in res.payload.events[0], false);
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries({ GOOGLE_CLIENT_ID: oldEnv.id, GOOGLE_CLIENT_SECRET: oldEnv.secret, GOOGLE_REFRESH_TOKEN: oldEnv.refresh })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test('calendar URL normalization accepts only http and https', () => {
  assert.equal(safeHttpUrl('https://example.com/path'), 'https://example.com/path');
  assert.equal(safeHttpUrl('http://example.com'), 'http://example.com/');
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpUrl('data:text/html,unsafe'), null);
  assert.equal(safeHttpUrl('file:///tmp/event'), null);
  assert.deepEqual(normalizedConferenceUrls({ entryPoints: [
    { entryPointType: 'video', uri: 'https://teams.microsoft.com/l/meetup-join/abc' },
    { entryPointType: 'video', uri: 'javascript:alert(1)' },
    { entryPointType: 'phone', uri: 'https://example.com/not-video' },
  ] }), ['https://teams.microsoft.com/l/meetup-join/abc']);
});

test('calendar events open safe detail views with meeting priority and mobile-safe actions', () => {
  assert.match(html, /class="cal-event [^\"]*" role="button" tabindex="0"/);
  assert.match(html, /openCalendarEventByIndex\(this\.dataset\.eventIndex\)/);
  assert.match(html, /id="calendar-event-panel"/);
  assert.match(html, /calendarEventDateLabel\(ev\)/);
  assert.match(html, /calendarEventTimeLabel\(ev\)/);
  assert.match(html, /calendar-event-description/);
  assert.match(html, /Join Meeting/);
  assert.match(html, /Open in Calendar/);
  assert.match(html, /conferenceUrls/);
  assert.match(html, /hangoutLink/);
  assert.match(html, /recognizedMeetingUrl\(clean\)/);
  assert.match(html, /target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /safeCalendarHttpUrl\(ev\.htmlLink\)/);
  assert.match(html, /esc\(ev\.description\)/);
  assert.match(html, /\.calendar-event-actions a \{[^}]*min-height: 44px/);
});
