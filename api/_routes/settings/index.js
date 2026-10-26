// Founder settings for the setup assistant. GET returns every section and which ones are done.
// POST { section, value } saves one section; POST { action: 'draft_voice', samples } turns pasted writing into voice rules.
import { withCommandAuth } from '../_lib/auth.js';
import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';
import { aiJson } from '../_lib/ai.js';
import { SECTIONS, founderSettings, saveSection, setupStatus, validZone } from '../_lib/founder-settings.js';

const LIMITS = { text: 4000, list: 40 };

function cleanValue(value, depth = 0) {
  if (depth > 3) return null;
  if (typeof value === 'string') return value.trim().slice(0, LIMITS.text);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, LIMITS.list).map((v) => cleanValue(v, depth + 1));
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 60).map(([k, v]) => [String(k).slice(0, 60), cleanValue(v, depth + 1)]));
  return null;
}

export function validateSection(section, value) {
  if (!SECTIONS.includes(section)) throw Object.assign(new Error('Unknown setup section.'), { code: 'VALIDATION_ERROR' });
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Object.assign(new Error('Send the answers as an object.'), { code: 'VALIDATION_ERROR' });
  const clean = cleanValue(value);
  if (section === 'schedule' && clean.time_zone && !validZone(clean.time_zone)) throw Object.assign(new Error('That time zone is not one Command knows. Pick one from the list.'), { code: 'VALIDATION_ERROR' });
  if (section === 'brands') {
    clean.list = (Array.isArray(clean.list) ? clean.list : []).filter((b) => b && (b.name || b.code)).slice(0, 8)
      .map((b) => ({ ...b, code: String(b.code || b.name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) }));
  }
  if (section === 'links') {
    for (const key of ['booking_url', 'demo_url', 'linkedin_url']) {
      if (clean[key] && !/^https:\/\/\S+$/i.test(clean[key])) throw Object.assign(new Error('Links need to start with https://'), { code: 'VALIDATION_ERROR' });
    }
  }
  if (section === 'founder' && clean.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean.email)) throw Object.assign(new Error('That email address does not look complete.'), { code: 'VALIDATION_ERROR' });
  return clean;
}

export async function draftVoice(samples, { ai = aiJson } = {}) {
  const text = String(samples || '').trim().slice(0, 8000);
  if (text.length < 200) throw Object.assign(new Error('Paste a little more of your writing first (a few emails or posts).'), { code: 'VALIDATION_ERROR' });
  const out = await ai({
    prompt: `Read these writing samples from one founder. Describe how they write, so an AI can write in the same voice.
Return JSON only: {"rules": "5 to 8 short lines, one per line, each a plain instruction such as 'Short sentences.' or 'Opens with the point, no small talk.'", "uses_long_dashes": true or false, "reading_level": "a grade level such as 6th grade, or empty"}
Describe only what the samples show. Do not copy their content.

SAMPLES:
${text}`, tier: 'fast', temperature: 0.2, maxTokens: 600,
  });
  return { rules: String(out?.rules || '').trim(), uses_long_dashes: out?.uses_long_dashes === true, reading_level: String(out?.reading_level || '').trim() };
}

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) return;
  try {
    const db = getSupabase();
    if (req.method === 'GET') {
      const settings = await founderSettings(db, { fresh: true });
      return sendData(res, { settings, status: setupStatus(settings) });
    }
    const body = bodyOf(req);
    if (body.action === 'draft_voice') return sendData(res, await draftVoice(body.samples));
    const value = validateSection(body.section, body.value);
    const saved = await saveSection(db, body.section, value, { complete: body.complete !== false });
    const settings = await founderSettings(db, { fresh: true });
    return sendData(res, { saved, status: setupStatus(settings) });
  } catch (error) { return sendError(res, error); }
}

export default withCommandAuth(handler);
