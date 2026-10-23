import { withCommandAuth } from '../_lib/auth.js';
import { allowMethods, bodyOf, sendData, sendError } from '../_lib/http.js';
import { getSupabase } from '../_lib/supabase.js';
import { geminiKey, modelsFor } from '../_lib/ai.js';
import { DEFAULT_SETTINGS, founderSettings, firstName, knowledgeText } from '../_lib/founder-settings.js';

// Reply help: the founder adds a screenshot of a LinkedIn (or any) conversation, and gets reply options written the
// way they write, already knowing their work (from setup). Nothing is sent from here; she copies the reply she likes.
export const maxDuration = 60;

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';
const IMAGE_DATA_URL = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/;
const NOTES_KEY = 'reply_help';

export function noDashes(text) { return String(text || '').replace(/\s*[–—]\s*/g, ', ').replace(/\s--\s/g, ', '); }

export function buildPrompt({ text = '', ask = '', tweak = '', notes = '', settings = DEFAULT_SETTINGS } = {}) {
  const name = firstName(settings);
  const booking = settings?.links?.booking_url ? (settings.links.booking_label || 'intro call') : '';
  const brands = (settings?.brands?.list || []).map((b) => b.name).filter(Boolean);
  return `${knowledgeText(settings)}
${notes ? `\nMORE TO KNOW (from ${name})\n${notes}\n` : ''}
YOUR JOB
${name} is replying to a message, usually on LinkedIn. Read the conversation in the screenshot and any pasted text. Work out who wrote to them, what they said or asked, and what they want. The newest message is usually at the bottom. Messages on the right or labeled "You" are ${name}'s own.
Then write 3 reply options ${name} could send as themself, each a different approach (for example: warm and short${booking ? `, offer a ${booking}` : ''}, answer their question in full). Match the length of the conversation: a quick note gets a quick reply.${brands.length ? ` Only mention ${brands.join(', ')} or links when they fit this person and this conversation.` : ''}${booking ? ` Offer the ${booking} link only when a call makes sense.` : ''} Use their first name if it shows.
${ask ? `\nWHAT ${name.toUpperCase()} WANTS TO SAY OR DO\n${ask}\n` : ''}${tweak ? `\nCHANGE FROM LAST TIME\n${tweak}\n` : ''}${text ? `\nPASTED CONVERSATION\n${text}\n` : ''}
Return JSON only:
{"who": "name and role if shown, else empty", "they_said": "one or two plain sentences on what they said and want", "watch_for": "one short note if something needs care (for example a sales pitch to them, a request for a free favor, a question they should answer themself), else empty", "replies": [{"label": "2 to 4 words", "text": "the reply"}]}`;
}

function parseJson(text) {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1));
}

export function shapeResult(parsed) {
  const replies = (Array.isArray(parsed?.replies) ? parsed.replies : []).map((r) => ({ label: noDashes(r?.label || 'Reply').slice(0, 40), text: noDashes(r?.text || '').trim() })).filter((r) => r.text).slice(0, 4);
  if (!replies.length) throw Object.assign(new Error('No reply came back. Try again.'), { status: 502 });
  return { who: noDashes(parsed?.who || '').slice(0, 200), they_said: noDashes(parsed?.they_said || '').slice(0, 600), watch_for: noDashes(parsed?.watch_for || '').slice(0, 400), replies };
}

async function readNotes(db) {
  const row = await db.from('command_notes').select('body').eq('note_key', NOTES_KEY).maybeSingle();
  if (row.error) throw row.error;
  return row.data?.body || '';
}

export async function writeReplies({ image = null, text = '', ask = '', tweak = '', notes = '', settings = DEFAULT_SETTINGS }, { fetchImpl = fetch } = {}) {
  const key = geminiKey();
  if (!key) throw Object.assign(new Error('Add the Gemini key to Command first.'), { status: 503 });
  const parts = [];
  if (image) { const m = image.match(IMAGE_DATA_URL); parts.push({ inlineData: { mimeType: m[1], data: m[2].replace(/\s+/g, '') } }); }
  parts.push({ text: buildPrompt({ text, ask, tweak, notes, settings }) });
  let last = null;
  for (const model of modelsFor(false)) {
    const response = await fetchImpl(`${GEMINI_API}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature: 0.7 } }),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 404) { last = payload; continue; }
    if (!response.ok) throw Object.assign(new Error(payload?.error?.message || 'The reply helper could not answer. Try again.'), { status: 502 });
    const out = (payload?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    return shapeResult(parseJson(out));
  }
  throw Object.assign(new Error(last?.error?.message || 'No writing model is available right now.'), { status: 502 });
}

async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) return;
  try {
    const db = getSupabase();
    if (req.method === 'GET') return sendData(res, { notes: await readNotes(db), settings: await founderSettings(db) });
    const body = bodyOf(req);
    if (body.action === 'save_notes') {
      const saved = await db.from('command_notes').upsert({ note_key: NOTES_KEY, body: String(body.notes || '').slice(0, 8000), updated_at: new Date().toISOString() }, { onConflict: 'note_key' });
      if (saved.error) throw saved.error;
      return sendData(res, { saved: true });
    }
    const image = typeof body.image_data === 'string' && body.image_data ? body.image_data : null;
    if (image && (image.length > 8 * 1024 * 1024 || !IMAGE_DATA_URL.test(image))) return sendError(res, { code: 'VALIDATION_ERROR', message: 'That picture could not be read. Try a PNG or JPG screenshot.' }, 400);
    const text = String(body.text || '').slice(0, 8000);
    if (!image && !text.trim()) return sendError(res, { code: 'VALIDATION_ERROR', message: 'Add a screenshot or paste the message first.' }, 400);
    const result = await writeReplies({ image, text, ask: String(body.ask || '').slice(0, 1500), tweak: String(body.tweak || '').slice(0, 500), notes: await readNotes(db), settings: await founderSettings(db) });
    return sendData(res, result);
  } catch (error) {
    console.error('[Reply help]', error?.message || error);
    return sendError(res, error);
  }
}

export default withCommandAuth(handler);
