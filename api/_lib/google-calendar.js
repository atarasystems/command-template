import './google-env.js';
import { envTimeZone } from './founder-settings.js';
// Every event Command adds carries this line, so Heads up knows it already holds no new detail.
export const APP_EVENT_MARKER = 'Added from Command.';

export async function getGoogleAccessToken() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) { const error = new Error('Google OAuth credentials not configured'); error.statusCode = 500; throw error; }
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token: GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token' }) });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok || !tokenData.access_token) { const error = new Error('Failed to get Google access token'); error.statusCode = 401; throw error; }
  return tokenData.access_token;
}

export async function createGoogleCalendarEvent(accessToken, payload) {
  const event = { ...(payload.eventId ? { id: payload.eventId } : {}), summary: payload.title, description: payload.description || APP_EVENT_MARKER, start: payload.allDay ? { date: String(payload.startISO).slice(0, 10) } : { dateTime: payload.startISO, timeZone: envTimeZone() }, end: payload.allDay ? { date: String(payload.endISO).slice(0, 10) } : { dateTime: payload.endISO, timeZone: envTimeZone() }, colorId: payload.colorId || '10' };
  const response = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
  const text = await response.text(); let data = {}; try { data = text ? JSON.parse(text) : {}; } catch (_) {}
  if (!response.ok) { const error = new Error(data.error?.message || text || 'Calendar event could not be created'); error.statusCode = response.status; throw error; }
  return data;
}

export async function getGoogleCalendarEvent(accessToken, eventId) {
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, { method: 'GET', headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await response.text(); let data = {}; try { data = text ? JSON.parse(text) : {}; } catch (_) {}
  if (!response.ok) { const error = new Error(data.error?.message || text || 'Calendar event lookup failed'); error.statusCode = response.status; throw error; }
  return data;
}

export async function listGoogleCalendarEvents(accessToken, startISO, endISO) {
  const params = new URLSearchParams({ timeMin: startISO, timeMax: endISO, singleEvents: 'true', orderBy: 'startTime', maxResults: '100' });
  const response = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || 'Calendar lookup failed');
  return (data.items || []).map((item) => ({ title: item.summary || '', start: item.start?.dateTime || item.start?.date || null, end: item.end?.dateTime || item.end?.date || null, allDay: Boolean(item.start?.date) }));
}
