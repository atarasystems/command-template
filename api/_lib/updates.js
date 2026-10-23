import { routeAi, aiKey } from './ai.js';
import { DEFAULT_SETTINGS, brandList, companyName, envTimeZone, firstName, founderSettings } from './founder-settings.js';
import { noDashesOn } from './email-style.js';
// Daily updates, follow-ups and week or month in review.
// Privacy rule: a review for an audience is written only from updates cleared for that audience.

export const SHARE_LEVELS = ['private', 'team', 'investor'];
export const AUDIENCES = ['me', 'team', 'investor'];
// Brands come from setup. Each update can be tagged with one brand code.
export function brandCodes(settings = DEFAULT_SETTINGS) { return brandList(settings).map((b) => String(b.code || b.name).toUpperCase().slice(0, 12)); }
function brandNames(settings = DEFAULT_SETTINGS) { return Object.fromEntries(brandList(settings).map((b) => [String(b.code || b.name).toUpperCase().slice(0, 12), b.name || b.code])); }
function audienceName(audience, settings = DEFAULT_SETTINGS) {
  return { me: `${firstName(settings)} only`, team: 'the team', investor: 'investors and advisors' }[audience] || audience;
}

// Which share levels an audience may see. Wider clearance includes the narrower audiences.
export function levelsFor(audience) {
  if (audience === 'investor') return ['investor'];
  if (audience === 'team') return ['team', 'investor'];
  return SHARE_LEVELS.slice();
}

export function easternDate(date = new Date()) {
  return new Date(date).toLocaleDateString('en-CA', { timeZone: envTimeZone() });
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
}

// Week runs Monday to Sunday. Month runs first to last day.
export function periodFor(kind, refDate = easternDate()) {
  const ref = String(refDate).slice(0, 10);
  if (kind === 'month') {
    const [y, m] = ref.split('-').map(Number);
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return { start, end };
  }
  const dow = new Date(ref + 'T12:00:00Z').getUTCDay();
  const start = addDays(ref, dow === 0 ? -6 : 1 - dow);
  return { start, end: addDays(start, 6) };
}

export function previousMonthRef(refDate = easternDate()) {
  const [y, m] = String(refDate).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
}

// Strips long dashes only when the founder turned on the no-dash rule in setup.
export function noDashes(text) {
  if (!noDashesOn()) return String(text || '');
  return String(text || '').replace(/\s*[—–]\s*/g, ', ').replace(/\s--\s/g, ', ').replace(/,\s*,/g, ',');
}

export function periodLabel(kind, period) {
  const s = new Date(period.start + 'T12:00:00Z'), e = new Date(period.end + 'T12:00:00Z');
  if (kind === 'month') return s.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return `${s.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} to ${e.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`;
}

export async function claude(system, user, { apiKey = aiKey(), fetchImpl = fetch, model = 'claude-sonnet-4-6', maxTokens = 1800 } = {}) {
  if (!apiKey) throw Object.assign(new Error('The writing assistant is not connected.'), { status: 503 });
  const response = await routeAi(fetchImpl)('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!response.ok) throw new Error(`Writing assistant returned ${response.status}`);
  const data = await response.json();
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

export function parseJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = raw.search(/[[{]/);
  return JSON.parse(start > 0 ? raw.slice(start) : raw);
}

export function cleanFollowups(list, today = easternDate()) {
  return (Array.isArray(list) ? list : []).map((f) => ({
    title: noDashes(String(f?.title || '').trim()).slice(0, 200),
    due_date: /^\d{4}-\d{2}-\d{2}$/.test(String(f?.due_date || '')) ? f.due_date : null,
    status: 'suggested',
  })).filter((f) => f.title).slice(0, 6).map((f) => (f.due_date && f.due_date < today ? { ...f, due_date: today } : f));
}

export async function extractFollowups(text, { today = easternDate(), settings = DEFAULT_SETTINGS, ...opts } = {}) {
  const system = `You find follow-ups and to-dos inside a founder's short daily update.
Return JSON only: an array of objects {"title": string, "due_date": "YYYY-MM-DD" or null}.
Rules:
- Only include things ${firstName(settings)} said they or ${companyName(settings)} need to do, send, check, schedule or follow up on.
- Title starts with a verb and names the person or thing, for example "Email Dana the intro".
- Use a date only when the update gives or clearly implies one. Today is ${today} (${new Date(today + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}).
- No follow-ups means [].
- Plain words.`;
  const out = await claude(system, String(text || '').slice(0, 4000), { model: 'claude-haiku-4-5-20251001', maxTokens: 500, ...opts });
  return cleanFollowups(parseJson(out), today);
}

export function reviewPrompt({ kind, audience, period, settings = DEFAULT_SETTINGS }) {
  const span = kind === 'month' ? 'month' : 'week';
  const forMe = audience === 'me';
  const name = settings?.founder?.name || firstName(settings);
  const company = companyName(settings);
  return `You write ${company}'s ${span} in review for ${audienceName(audience, settings)}, in ${name}'s voice ("we" for ${company}, "I" for ${firstName(settings)}).
Period: ${periodLabel(kind, period)}.

STRICT RULES
- Use only the notes provided. Add no facts, numbers, names, outcomes or plans that the notes do not state.
- ${forMe ? `This is for ${firstName(settings)} alone. Include everything useful, plus a short "Follow-ups" list.` : 'Everything provided is cleared for this audience. Keep it professional and concise. Leave out follow-ups, internal to-dos and anything that reads as private.'}
- Plain language at an easy reading level. Short sections with simple headings. Bullets are fine.
- Say what happened and what is next.${settings?.voice?.no_dashes ? '\n- No em dashes, en dashes or double hyphens anywhere.' : ''}${settings?.voice?.banned_words?.length ? `\n- Never use: ${settings.voice.banned_words.join(', ')}.` : ''}
- Group by brand when there is more than one brand.
- If the notes are thin, keep the review short. Never pad.

Return JSON only:
{"title": "short title", "body": "the review as plain text with simple headings", "followups": ${forMe ? '[{"title": "...", "due_date": "YYYY-MM-DD or null"}]' : '[]'}}`;
}

export function notesText(updates, completedTasks = [], settings = DEFAULT_SETTINGS) {
  const names = brandNames(settings);
  const lines = updates.map((u) => `- ${u.entry_date}${u.brand ? ` [${names[u.brand] || u.brand}]` : ''}: ${String(u.body).trim()}`);
  if (completedTasks.length) {
    lines.push('', 'Tasks completed:');
    for (const t of completedTasks) lines.push(`- ${String(t.completed_at || '').slice(0, 10)}: ${t.title}`);
  }
  return lines.join('\n') || '(no notes this period)';
}

export async function writeReview({ kind, audience, period, updates, completedTasks = [], settings = DEFAULT_SETTINGS }, opts = {}) {
  const out = await claude(reviewPrompt({ kind, audience, period, settings }), notesText(updates, audience === 'me' ? completedTasks : [], settings), opts);
  const parsed = parseJson(out);
  return {
    title: noDashes(String(parsed.title || `${kind === 'month' ? 'Month' : 'Week'} in review`)).slice(0, 160),
    body: noDashes(String(parsed.body || '')).trim(),
    followups: audience === 'me' ? cleanFollowups(parsed.followups) : [],
  };
}

// Pull the notes an audience may see, plus completed tasks for the founder's own review.
export async function gatherForReview(db, { audience, period }) {
  const updates = await db.from('command_updates').select('id,entry_date,body,brand,share_level')
    .is('deleted_at', null).gte('entry_date', period.start).lte('entry_date', period.end)
    .in('share_level', levelsFor(audience)).order('entry_date', { ascending: true });
  if (updates.error) throw updates.error;
  let completed = [];
  if (audience === 'me') {
    const tasks = await db.from('work_items').select('title,completed_at').eq('status', 'done')
      .gte('completed_at', period.start + 'T00:00:00-05:00').lte('completed_at', period.end + 'T23:59:59-04:00').limit(100);
    if (!tasks.error) completed = tasks.data || [];
  }
  return { updates: updates.data || [], completedTasks: completed };
}

export async function createReview(db, { kind, audience = 'me', refDate = easternDate() }, opts = {}) {
  const period = periodFor(kind, refDate);
  const { updates, completedTasks } = await gatherForReview(db, { audience, period });
  if (!updates.length && !completedTasks.length) {
    const err = new Error(audience === 'me' ? 'There are no updates in this period yet.' : 'No updates in this period are cleared for this audience yet. Change an update\'s share level to include it.');
    err.status = 409; err.code = 'NOTHING_TO_REVIEW'; throw err;
  }
  const written = await writeReview({ kind, audience, period, updates, completedTasks, settings: await founderSettings(db) }, opts);
  const row = await db.from('command_reviews').insert({ kind, audience, period_start: period.start, period_end: period.end, ...written }).select('*').single();
  if (row.error) throw row.error;
  return row.data;
}

export function base64url(text) {
  return Buffer.from(text).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function reviewEmailRaw({ to, subject, body }) {
  const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const boundary = 'command_review_' + Date.now();
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#202124;white-space:pre-wrap">${esc(body)}</div>`;
  return base64url([
    'MIME-Version: 1.0', 'From: me', `To: ${to}`, `Subject: ${subject}`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', '', body, '',
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', '', html, '',
    `--${boundary}--`,
  ].join('\r\n'));
}
