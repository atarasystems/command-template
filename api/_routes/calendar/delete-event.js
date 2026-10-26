import '../_lib/google-env.js';
import { withCommandAuth } from '../_lib/auth.js';

async function getAccessToken() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    const error = new Error('Google Calendar is not configured');
    error.status = 500;
    throw error;
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokenData.access_token) {
    const error = new Error(tokenData?.error_description || 'Could not connect to Google Calendar');
    error.status = 502;
    throw error;
  }
  return tokenData.access_token;
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: { message: 'Method not allowed' } });
  }

  try {
    const eventId = String(req.body?.eventId || '').trim();
    if (!eventId || eventId.length > 1024) {
      return res.status(400).json({ ok: false, error: { message: 'Calendar event ID is required' } });
    }

    const accessToken = await getAccessToken();
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`;
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (response.status === 404 || response.status === 410) {
      return res.status(200).json({ ok: true, data: { eventId, already_removed: true } });
    }
    if (!response.ok) {
      const detail = await response.text();
      console.error('[Calendar delete]', response.status, detail.slice(0, 500));
      return res.status(response.status).json({ ok: false, error: { message: 'Google Calendar did not delete that event' } });
    }

    return res.status(200).json({ ok: true, data: { eventId, deleted: true } });
  } catch (error) {
    console.error('[Calendar delete]', error.message);
    return res.status(error.status || 500).json({ ok: false, error: { message: error.message || 'Could not delete calendar event' } });
  }
}

export default withCommandAuth(handler);
export const config = { maxDuration: 30 };
