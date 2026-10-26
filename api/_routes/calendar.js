import './_lib/google-env.js';
// api/calendar.js
// Fetches Google Calendar events directly via Google Calendar REST API
// Uses OAuth refresh token stored in Vercel env vars
import { withCommandAuth } from './_lib/auth.js';
import { envTimeZone } from './_lib/founder-settings.js';

export function safeHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function normalizedConferenceUrls(conferenceData) {
  return [...new Set((conferenceData?.entryPoints || [])
    .filter((entry) => entry?.entryPointType === 'video')
    .map((entry) => safeHttpUrl(entry.uri))
    .filter(Boolean))];
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { startISO, endISO } = req.body;
  if (!startISO || !endISO) {
    return res.status(400).json({ error: 'startISO and endISO required' });
  }

  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    return res.status(500).json({ error: 'Google OAuth credentials not configured' });
  }


  try {
    // Step 1: Get fresh access token using refresh token
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

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.status(401).json({ error: 'Failed to get access token', detail: tokenData });
    }

    const accessToken = tokenData.access_token;

    // Step 2: Fetch calendar events
    const params = new URLSearchParams({
      timeMin: startISO,
      timeMax: endISO,
      singleEvents: 'true',
      orderBy: 'startTime',
      timeZone: envTimeZone(),
      maxResults: '100',
    });

    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    if (!calRes.ok) {
      const err = await calRes.text();
      return res.status(calRes.status).json({ error: 'Calendar API error', detail: err });
    }

    const calData = await calRes.json();
    const items = calData.items || [];

    // Step 3: Normalize events
    const events = items
      .filter(ev => ev.status !== 'cancelled')
      .map(ev => {
        const isAllDay = !!ev.start?.date;
        const start = ev.start?.dateTime || ev.start?.date || '';
        const end   = ev.end?.dateTime   || ev.end?.date   || '';
        const title = ev.summary || '(no title)';
        const colorId = ev.colorId || '';
        // Events Command adds use color 10, so they read as the founder's own work blocks.
        const isAtara = ['2', '10'].includes(String(colorId));
        return {
          id: ev.id,
          title,
          start,
          end,
          colorId,
          allDay: isAllDay,
          isAtara,
          location: typeof ev.location === 'string' ? ev.location : null,
          description: typeof ev.description === 'string' ? ev.description : null,
          htmlLink: safeHttpUrl(ev.htmlLink),
          hangoutLink: safeHttpUrl(ev.hangoutLink),
          conferenceUrls: normalizedConferenceUrls(ev.conferenceData),
        };
      });

    return res.status(200).json({ events });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

export default withCommandAuth(handler);
