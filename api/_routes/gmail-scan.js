import './_lib/google-env.js';
// api/gmail-scan.js
// Scans Gmail inbox headers for the last N days.
// Returns unique real-person senders not matching automated patterns.
// Required env vars: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
import { withCommandAuth } from './_lib/auth.js';

export const config = { runtime: 'nodejs' };

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function getAccessToken() {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GMAIL_CLIENT_ID,
      client_secret: process.env.GMAIL_CLIENT_SECRET,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN,
      grant_type:    'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Could not get access token: ' + JSON.stringify(data));
  return data.access_token;
}

const SKIP_PATTERNS = [
  /noreply/i, /no-reply/i, /donotreply/i, /do-not-reply/i,
  /notifications?@/i, /mailer@/i, /bounce/i, /postmaster/i,
  /mailchimp/i, /sendgrid/i, /mailgun/i, /amazonses/i,
  /constantcontact/i, /klaviyo/i, /hubspot/i, /salesforce/i,
  /marketo/i, /pardot/i,
  /@google\.com$/i, /@linkedin\.com$/i, /@twitter\.com$/i,
  /@facebook\.com$/i, /@github\.com$/i, /@slack\.com$/i,
  /@zoom\.us$/i, /@calendly\.com$/i, /@stripe\.com$/i,
  /@paypal\.com$/i, /@intuit\.com$/i, /@quickbooks/i,
  /@usps\.com$/i, /@fedex\.com$/i, /@ups\.com$/i,
  /@amazon\.com$/i, /@apple\.com$/i, /@microsoft\.com$/i,
];

const SKIP_LOCAL = /^(info|hello|support|help|contact|team|admin|billing|sales|marketing|newsletter|updates|alerts|news|noreply|no.reply|donotreply|feedback|unsubscribe|hello|hi|hey)$/i;

function isRealPerson(email) {
  if (!email || !email.includes('@')) return false;
  const [local] = email.toLowerCase().split('@');
  if (SKIP_LOCAL.test(local)) return false;
  for (const pat of SKIP_PATTERNS) {
    if (pat.test(email)) return false;
  }
  return true;
}

function parseFrom(header) {
  // "First Last <email@example.com>" or "email@example.com"
  const match = header.match(/^"?([^"<]*?)"?\s*<([^>]+)>/);
  if (match) {
    return {
      name:  match[1].trim().replace(/^"|"$/g, ''),
      email: match[2].trim().toLowerCase(),
    };
  }
  return { name: '', email: header.trim().toLowerCase() };
}

async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET || !process.env.GMAIL_REFRESH_TOKEN) {
    return res.status(500).json({ ok: false, error: 'Gmail OAuth env vars not configured.' });
  }

  try {
    const { days = 30 } = req.body || {};
    const after = Math.floor((Date.now() - days * 24 * 60 * 60 * 1000) / 1000);

    const accessToken = await getAccessToken();

    // Fetch up to 100 inbox messages after the cutoff date
    const listRes = await fetch(
      `${GMAIL_API}/messages?maxResults=100&q=in:inbox+after:${after}`,
      { headers: { Authorization: 'Bearer ' + accessToken } }
    );
    const listData = await listRes.json();

    if (!listData.messages || !listData.messages.length) {
      return res.status(200).json({ ok: true, suggestions: [] });
    }

    const seen = new Map(); // email -> name

    // Fetch headers in parallel batches of 20
    const fetchHeader = async (msgId) => {
      try {
        const r = await fetch(
          `${GMAIL_API}/messages/${msgId}?format=metadata&metadataHeaders=From`,
          { headers: { Authorization: 'Bearer ' + accessToken } }
        );
        const d = await r.json();
        const fromHeader = d.payload?.headers?.find(h => h.name === 'From')?.value || '';
        if (!fromHeader) return;
        const { name, email } = parseFrom(fromHeader);
        if (email && isRealPerson(email) && !seen.has(email)) {
          seen.set(email, name || email.split('@')[0]);
        }
      } catch (_) { /* skip individual failures */ }
    };

    const ids = listData.messages.map(m => m.id);
    for (let i = 0; i < ids.length; i += 20) {
      await Promise.all(ids.slice(i, i + 20).map(fetchHeader));
    }

    const suggestions = Array.from(seen.entries())
      .map(([email, name]) => ({ email, name }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json({ ok: true, suggestions });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

export default withCommandAuth(handler);
