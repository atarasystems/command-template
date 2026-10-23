// api/create-event.js
// Creates a Google Calendar event via Google Calendar REST API
import { withCommandAuth } from './_lib/auth.js';
import { createGoogleCalendarEvent, getGoogleAccessToken } from './_lib/google-calendar.js';

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { title, startISO, endISO, description, colorId, allDay = false } = req.body;
  if (!title || !startISO || !endISO) {
    return res.status(400).json({ error: 'title, startISO, endISO required' });
  }

  try {
    const created = await createGoogleCalendarEvent(await getGoogleAccessToken(), { title, startISO, endISO, description, colorId, allDay });
    return res.status(200).json({ success: true, eventId: created.id });

  } catch (e) {
    return res.status(e.statusCode || 500).json({ success: false, error: e.message });
  }
}

export default withCommandAuth(handler);
