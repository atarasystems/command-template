// Funding Finder: every morning it searches for open grants, accelerators, pitch competitions and credit programs that fit
// the founder's company (from the Funding section of setup), and adds the good ones to the Funding Hub. It never applies.
// Deadline reminders: anything the founder has not passed on shows on Today 7, 3 and 1 days before it closes, and on the day.
import { aiText } from './ai.js';
import { ingestFundingWatch, normalizeUrl } from './funding-watch.js';
import { searchSerper, searchWeb } from './web-search.js';
import { provisionalScores } from './funding-scores.js';
import { fundingSearch } from './google-search.js';
import { DEFAULT_SETTINGS, envTimeZone, founderSettings, fundingProfileText, fundingQueries, fundingRegions, firstName } from './founder-settings.js';

const defaultSearch = (args) => fundingSearch(args, { tavily: searchWeb, serper: searchSerper });

const TYPES = new Set(['grant', 'accelerator', 'pitch_competition', 'procurement', 'funding', 'fellowship', 'program', 'other']);
const FITS = new Set(['very_high', 'high', 'medium', 'investigate']);
const STRUCTURES = new Set(['grant', 'reimbursement', 'investment', 'credits', 'prize', 'other']);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function noDashes(value) { return String(value || '').replace(/\s*[—–]\s*/g, ': ').replace(/--+/g, ', '); }

function easternToday(now = new Date()) { return new Date(now).toLocaleDateString('en-CA', { timeZone: envTimeZone() }); }

export function queriesFor(now = new Date(), count = 10, settings = DEFAULT_SETTINGS) {
  const FUNDING_QUERIES = fundingQueries(settings);
  const d = new Date(now);
  // Each half day gets its own slice, so the morning and afternoon runs search different things.
  const day = Math.floor(d.getTime() / 43200000);
  const fill = (q) => q.replace('{year}', String(d.getUTCFullYear())).replace('{month}', MONTHS[d.getUTCMonth()]);
  return Array.from({ length: Math.min(count, FUNDING_QUERIES.length) }, (_, i) => fill(FUNDING_QUERIES[(day * count + i) % FUNDING_QUERIES.length]));
}

export function judgeRules(settings = DEFAULT_SETTINGS) {
  const regions = fundingRegions(settings);
  return `You review web search results for a small company looking for funding. The company:
${fundingProfileText(settings)}

For each result, decide if it is ONE specific funding opportunity that this company could apply to, and that is open now or opens soon.
Keep: a specific grant, accelerator, pitch competition, fellowship, prize, SBIR/STTR topic, or credits program with its own application.
Keep corporate and foundation programs too: grants, awards, contests and accelerators run by companies or their foundations for groups the founder belongs to or for this company's field.
Skip: news stories, blog lists of many grants, directories, past winners pages, programs that closed, programs only for nonprofits, students,
places the company cannot apply from (${regions ? `${regions} and nationwide are fine` : 'nationwide programs are fine'}), or other industries with no link to this company's work or to small business.
Skip anything that costs money to apply or join: an application fee, entry fee, submission fee, or a paid membership or subscription required to be eligible. Keep it only when applying is free or the result does not mention any fee.
Use only what the result says. Never invent a deadline or amount. If the deadline is not stated, use null.
fit_label: very_high (made for this kind of company), high, medium, or investigate (might fit, needs a look).
Return JSON only: an array with one object per result you KEEP:
{"index": number, "program_name": string, "organization": string, "opportunity_type": one of grant|accelerator|pitch_competition|procurement|funding|fellowship|program|other,
 "deadline": "YYYY-MM-DD" or null, "amount_text": string or null, "funding_structure": one of grant|reimbursement|investment|credits|prize|other,
 "is_non_dilutive": boolean, "eligibility": short string, "fit_label": string, "fit_rationale": one plain sentence on why it fits}
Return [] if none qualify.`;
}

export async function judgeResults(results, { ai = aiText, today, settings = DEFAULT_SETTINGS } = {}) {
  if (!results.length) return [];
  const list = results.map((r, index) => ({ index, title: r.title, url: r.url, snippet: String(r.snippet || '').slice(0, 700) }));
  const text = await ai({ system: judgeRules(settings), user: `Today is ${today}.\n\nResults:\n${JSON.stringify(list, null, 1)}`, tier: 'write', maxTokens: 3000 });
  const raw = String(text || '').replace(/^[^[]*/, '').replace(/[^\]]*$/, '');
  const parsed = JSON.parse(raw || '[]');
  return (Array.isArray(parsed) ? parsed : []).filter((k) => Number.isInteger(k?.index) && results[k.index]);
}

export function toWatchPayload(kept, result, today) {
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(kept.deadline || '')) ? kept.deadline : null;
  if (deadline && deadline < today) return null;
  if (!TYPES.has(kept.opportunity_type) || !kept.program_name) return null;
  return {
    program_name: noDashes(kept.program_name).slice(0, 300),
    organization: String(kept.organization || '').slice(0, 300) || null,
    opportunity_type: kept.opportunity_type,
    official_url: result.url,
    deadline,
    amount_text: kept.amount_text ? String(kept.amount_text).slice(0, 300) : undefined,
    funding_structure: STRUCTURES.has(kept.funding_structure) ? kept.funding_structure : undefined,
    is_non_dilutive: typeof kept.is_non_dilutive === 'boolean' ? kept.is_non_dilutive : undefined,
    eligibility: kept.eligibility ? String(kept.eligibility).slice(0, 2000) : undefined,
    fit_label: FITS.has(kept.fit_label) ? kept.fit_label : 'investigate',
    fit_rationale: kept.fit_rationale ? String(kept.fit_rationale).slice(0, 1000) : undefined,
    source_type: 'funding_finder',
  };
}

// ---- Only real program pages ---------------------------------------------------------------------------------------
const PICTURE = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)(\?|$)/i;
export function looksLikeProgramPage(url) {
  const u = String(url || '');
  if (!/^https?:\/\//i.test(u)) return false;
  if (PICTURE.test(u)) return false;
  if (/\/wp-content\/uploads\//i.test(u) && !/\.pdf(\?|$)/i.test(u)) return false;
  return true;
}

async function readPage(url, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(9000), headers: { Accept: 'text/html,application/xhtml+xml,application/pdf' } });
    const type = String(response.headers?.get?.('content-type') || '').toLowerCase();
    const finalUrl = response.url || url;
    if (!response.ok) return { ok: false, type, url: finalUrl, text: '' };
    if (!/text\/html|application\/xhtml|application\/pdf/.test(type)) return { ok: false, type, url: finalUrl, text: '' };
    const text = /pdf/.test(type) ? '' : readable((await response.text()).slice(0, 400000)).slice(0, 12000);
    return { ok: true, type, url: finalUrl, text };
  } catch { return { ok: false, type: '', url, text: '' }; }
}

export function pageRules(settings = DEFAULT_SETTINGS) {
  return `You read the official web page for ONE funding program, for this company:
${fundingProfileText(settings)}

Report only what the page says. Never invent fees, dates or amounts.
Return JSON only:
{"application_fee": "none" or the fee as written (for example "$15") or "unknown",
 "nonprofit_only": boolean (true only if the page says applicants must be nonprofits or 501(c)(3)s),
 "revenue_minimum": number in US dollars or null (the minimum revenue to apply, if stated),
 "deadline": "YYYY-MM-DD" or null (this round only),
 "requirements": ["what the application asks for, one short line each, in order"],
 "effort_hours_min": number or null, "effort_hours_max": number or null}`;
}

// The founder's yearly revenue from setup, as a number, so programs with a higher revenue floor are skipped.
export function currentRevenue(settings = DEFAULT_SETTINGS) {
  const m = String(settings?.funding?.revenue || '').replace(/,/g, '').match(/\d+(?:\.\d+)?\s*[km]?/i);
  if (!m) return null;
  const n = parseFloat(m[0]);
  return /k/i.test(m[0]) ? n * 1000 : /m/i.test(m[0]) ? n * 1_000_000 : n;
}

// Read the official page before saving: skip paid applications, nonprofit-only programs, and revenue floors above ours.
export async function checkProgramPage(url, { ai = aiText, fetchImpl = fetch, today, settings = DEFAULT_SETTINGS } = {}) {
  const page = await readPage(url, fetchImpl);
  if (!page.ok) return { skip: 'not_a_page' };
  if (!page.text) return { ok: true, url: page.url, facts: {} };
  let facts = {};
  try {
    const raw = await ai({ system: pageRules(settings), user: `Today is ${today}. Page ${page.url}:\n${page.text}`, tier: 'write', maxTokens: 900 });
    facts = JSON.parse(String(raw || '').replace(/^[^{]*/, '').replace(/[^}]*$/, ''));
  } catch { facts = {}; }
  const fee = String(facts.application_fee || 'unknown').trim().toLowerCase();
  if (fee && fee !== 'none' && fee !== 'unknown' && fee !== '$0' && fee !== 'free') return { skip: 'application_fee', fee: facts.application_fee };
  const nonprofit = /nonprofit|501\(c\)/i.test(settings?.company?.entity_type || '');
  if (facts.nonprofit_only === true && !nonprofit) return { skip: 'nonprofit_only' };
  const revenue = currentRevenue(settings);
  if (revenue !== null && Number(facts.revenue_minimum) > revenue) return { skip: 'revenue_minimum' };
  return { ok: true, url: page.url, facts };
}

// ---- Grants.gov: federal programs, including ones only forecast so far ---------------------------------------------
// Federal keywords come from setup. Without them, Grants.gov is searched for small business innovation programs.
export function grantsGovKeywords(settings = DEFAULT_SETTINGS) {
  const own = (settings?.funding?.federal_keywords || []).map((k) => String(k).trim()).filter(Boolean);
  return own.length ? own : ['SBIR', 'small business innovation'];
}
export async function searchGrantsGov({ keyword, fetchImpl = fetch } = {}) {
  const response = await fetchImpl('https://api.grants.gov/v1/api/search2', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000),
    body: JSON.stringify({ keyword, oppStatuses: 'forecasted|posted', rows: 10 }),
  });
  if (!response.ok) throw new Error(`Grants.gov search failed with status ${response.status}`);
  const payload = await response.json().catch(() => ({}));
  const hits = payload?.data?.oppHits || [];
  return hits.map((h) => ({
    title: `${h.title || ''} (${h.number || ''})`.trim(),
    url: `https://www.grants.gov/search-results-detail/${h.id}`,
    snippet: `Federal ${h.oppStatus || ''} opportunity from ${h.agency || h.agencyCode || 'a federal agency'}. Opens ${h.openDate || 'unknown'}. Closes ${h.closeDate || 'not set'}.`,
    forecasted: String(h.oppStatus || '').toLowerCase() === 'forecasted',
    open_date: h.openDate || null,
  }));
}

function usDate(value) {
  const m = String(value || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : (/^\d{4}-\d{2}-\d{2}/.test(String(value || '')) ? String(value).slice(0, 10) : null);
}

export async function findFunding(db, { now = new Date(), search = defaultSearch, ai = aiText, queries = 12, ingest = ingestFundingWatch, check = checkProgramPage, grantsGov = searchGrantsGov, fetchImpl = fetch, settings = null } = {}) {
  settings = settings || await founderSettings(db);
  const today = easternToday(now);
  const summary = { searches: 0, results: 0, new_results: 0, kept: 0, added: 0, updated: 0, skipped_fee: 0, skipped_nonprofit: 0, skipped_revenue: 0, skipped_not_page: 0, failed: 0 };
  const known = await db.from('crm_program_opportunities').select('source_url').limit(1000);
  if (known.error) throw known.error;
  const seen = new Set((known.data || []).map((r) => { try { return normalizeUrl(r.source_url); } catch { return null; } }).filter(Boolean));
  const fresh = [];
  const take = (r) => {
    summary.results += 1;
    let url = null; try { url = normalizeUrl(r.url); } catch { url = null; }
    if (!url || seen.has(url)) return;
    if (!looksLikeProgramPage(url)) { summary.skipped_not_page += 1; return; }
    seen.add(url); fresh.push({ ...r, url });
  };
  for (const query of queriesFor(now, queries, settings)) {
    summary.searches += 1;
    try { for (const r of (await search({ query, maxResults: 8 })) || []) take(r); }
    catch (error) { summary.failed += 1; summary.search_error = summary.search_error || String(error?.message || error).slice(0, 200); }
  }
  // Grants.gov once a day (morning run), one keyword per day.
  if (grantsGov && new Date(now).getUTCHours() < 12) {
    const keywords = grantsGovKeywords(settings);
    const keyword = keywords[Math.floor(new Date(now).getTime() / 86400000) % keywords.length];
    summary.searches += 1;
    try { for (const r of (await grantsGov({ keyword, fetchImpl })) || []) take(r); }
    catch (error) { summary.failed += 1; summary.search_error = summary.search_error || String(error?.message || error).slice(0, 200); }
  }
  summary.new_results = fresh.length;
  for (let i = 0; i < fresh.length; i += 15) {
    const batch = fresh.slice(i, i + 15);
    let kept = [];
    try { kept = await judgeResults(batch, { ai, today, settings }); } catch (error) { summary.failed += 1; console.error('[Funding finder] judge', error.message); continue; }
    for (const k of kept) {
      const result = batch[k.index];
      const payload = toWatchPayload(k, result, today);
      if (!payload) continue;
      try {
        // Read the official page before saving it.
        const page = await check(result.url, { ai, fetchImpl, today });
        if (page.skip) {
          if (page.skip === 'application_fee') summary.skipped_fee += 1;
          else if (page.skip === 'nonprofit_only') summary.skipped_nonprofit += 1;
          else if (page.skip === 'revenue_minimum') summary.skipped_revenue += 1;
          else summary.skipped_not_page += 1;
          continue;
        }
        const f = page.facts || {};
        if (page.url) { try { payload.official_url = normalizeUrl(page.url); } catch { /* keep the search link */ } }
        const pageDeadline = /^\d{4}-\d{2}-\d{2}$/.test(String(f.deadline || '')) ? f.deadline : null;
        if (pageDeadline) { if (pageDeadline < today) continue; payload.deadline = pageDeadline; }
        const checklist = (Array.isArray(f.requirements) ? f.requirements : []).map((x) => noDashes(String(x || '')).trim().slice(0, 300)).filter(Boolean).slice(0, 15);
        if (checklist.length) payload.application_requirements = { checklist };
        if (Number(f.effort_hours_min) > 0) payload.effort_min_hours = Number(f.effort_hours_min);
        if (Number(f.effort_hours_max) > 0) payload.effort_max_hours = Math.max(Number(f.effort_hours_max), Number(f.effort_hours_min) || 0);
        summary.kept += 1;
        const saved = await ingest(payload, db);
        if (saved.status === 'created') summary.added += 1; else if (saved.status === 'updated') summary.updated += 1;
        const opp = saved.opportunity;
        if (opp?.id) {
          const patch = provisionalScores(opp, { today });
          // Forecast federal programs are watched until they open.
          if (result.forecasted && saved.status === 'created') Object.assign(patch, { status: 'watching', next_open_at: usDate(result.open_date) });
          if (Object.keys(patch).length) await db.from('crm_program_opportunities').update(patch).eq('id', opp.id);
        }
      } catch (error) { summary.failed += 1; console.error('[Funding finder] save', error.message); }
    }
  }
  return summary;
}

// ---- Scout health: three empty runs in a row show up on Today -------------------------------------------------------
export async function recordScoutRun(db, summary, { now = new Date() } = {}) {
  await db.from('command_funding_scout_runs').insert({ ran_at: new Date(now).toISOString(), summary });
  const recent = await db.from('command_funding_scout_runs').select('summary,ran_at').order('ran_at', { ascending: false }).limit(3);
  if (recent.error) return { checked: false };
  const runs = recent.data || [];
  const empty = (r) => !Number(r.summary?.added) || Boolean(r.summary?.search_error);
  const stuck = runs.length === 3 && runs.every(empty);
  const today = easternToday(now);
  if (stuck) {
    const lastError = runs.map((r) => r.summary?.search_error).find(Boolean);
    await db.from('command_heads_up').upsert({
      source: 'funding', source_id: 'funding-scout-health', source_updated: today, title: 'Funding Scout found nothing new in 3 runs',
      starts_at: `${today}T12:00:00Z`, all_day: true, location: null, join_link: null,
      heads_up: lastError ? `Last error: ${noDashes(lastError).slice(0, 300)}` : 'The searches ran but found no new programs.',
      prep: [{ text: 'Ask Claude to check the Funding Scout.', done: false }], has_news: true, acknowledged_at: null, dismissed_at: null, updated_at: new Date().toISOString(),
    }, { onConflict: 'source_id' });
  }
  return { stuck };
}

// Deadline reminders on Today. Each program gets one heads up that moves through steps:
// decide (2 days before its start-by date), start (on the start-by date), then 14, 7, 3 and 1 days before the deadline, and the day itself.
// A new step brings it back to the top; the same step keeps her checkmarks and Got it. No money amounts on Today.
const ACTIVE = ['discovered', 'reviewing', 'apply', 'drafting', 'in_progress'];
const DUE_STEPS = [0, 1, 3, 5, 7, 10, 14];

function addDaysKey(key, days) { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function daysBetween(a, b) { return Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000); }
function shortDate(key) { return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
function longDate(key) { return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); }

export function fundingStep(p, today) {
  const deadline = p.deadline_at ? easternDayOf(p.deadline_at) : null;
  if (!deadline || deadline < today) return null;
  const left = daysBetween(today, deadline);
  const due = DUE_STEPS.find((s) => left <= s);
  const finishBy = addDaysKey(deadline, -7);
  // Her rule: every application is finished a week before it is due.
  if (due !== undefined && due <= 7) return { key: `due-${due}`, left, deadline, finishBy, title: `${left === 0 ? 'Due today' : left === 1 ? 'Due tomorrow' : `Due in ${left} days`}. Do it now` };
  if (due !== undefined) return { key: `due-${due}`, left, deadline, finishBy, title: `Finish by ${shortDate(finishBy)}` };
  const start = p.prep_start_at || null;
  if (start && today >= start) return { key: 'start', left, deadline, finishBy, title: `Start now, finish by ${shortDate(finishBy)}` };
  const undecided = ['discovered', 'reviewing'].includes(p.status);
  if (start && undecided && today >= addDaysKey(start, -2)) return { key: 'decide', left, deadline, finishBy, title: 'Decide: apply or pass' };
  return null;
}

function easternDayOf(value) { return new Date(value).toLocaleDateString('en-CA', { timeZone: envTimeZone() }); }

export async function fundingDeadlineHeadsUp(db, { now = new Date() } = {}) {
  const today = easternToday(now);
  const until = addDaysKey(today, 30);
  const rows = await db.from('crm_program_opportunities').select('id,title,organization,deadline_at,prep_start_at,source_url,status,application_requirements_json')
    .in('status', ACTIVE).is('dismissed_at', null).gte('deadline_at', today).lte('deadline_at', `${addDaysKey(today, 200)}T23:59:59Z`);
  if (rows.error) throw rows.error;
  const list = rows.data || [];
  const ids = list.map((p) => p.id);
  const prepRows = ids.length ? await db.from('command_funding_prep_items').select('opportunity_id,text,done_at,sort').in('opportunity_id', ids).order('sort') : { data: [] };
  const prepBy = new Map();
  (prepRows.data || []).forEach((r) => { if (!prepBy.has(r.opportunity_id)) prepBy.set(r.opportunity_id, []); prepBy.get(r.opportunity_id).push(r); });
  let made = 0;
  for (const p of list) {
    const step = fundingStep(p, today);
    if (!step) continue;
    const id = `funding:${p.id}`;
    const existing = await db.from('command_heads_up').select('id,source_updated').eq('source_id', id).maybeSingle();
    if (existing.error) throw existing.error;
    const fresh = existing.data?.source_updated !== `step-${step.key}`;
    const own = (prepBy.get(p.id) || []).filter((r) => !r.done_at).map((r) => r.text);
    const checklist = Array.isArray(p.application_requirements_json?.checklist) ? p.application_requirements_json.checklist : [];
    const prepText = step.key === 'decide' ? ['Open the program page and check it fits.', 'Decide: Choose to Apply, or mark it as a pass in the Funding Hub.']
      : (own.length ? own : checklist.length ? checklist : ['Open the application page and check what it asks for.']).slice(0, 10);
    const row = {
      source: 'funding', source_id: id, source_updated: `step-${step.key}`,
      title: noDashes(`${step.title}: ${p.title}`).slice(0, 300),
      starts_at: `${step.deadline}T12:00:00Z`, all_day: true, location: null, join_link: p.source_url || null,
      heads_up: noDashes(`${p.organization ? p.organization + '. ' : ''}Finish by ${longDate(step.finishBy || step.deadline)}. Deadline ${longDate(step.deadline)}.`),
      has_news: true, updated_at: new Date().toISOString(),
      ...(fresh ? { acknowledged_at: null, dismissed_at: null, prep: prepText.map((text) => ({ text: noDashes(String(text)).slice(0, 400), done: false })) } : {}),
    };
    const saved = await db.from('command_heads_up').upsert(row, { onConflict: 'source_id' });
    if (saved.error) throw saved.error;
    if (fresh) made += 1;
  }
  // Mondays: one look-ahead at the next 30 days of start-by dates and deadlines.
  let weekly = false;
  if (new Date(`${today}T12:00:00Z`).getUTCDay() === 1) {
    const lines = [];
    for (const p of list) {
      const deadline = easternDayOf(p.deadline_at);
      if (p.prep_start_at && p.prep_start_at >= today && p.prep_start_at <= until) lines.push({ when: p.prep_start_at, text: `Start ${p.title}` });
      if (deadline <= until) lines.push({ when: deadline, text: `Due: ${p.title}` });
    }
    lines.sort((a, b) => a.when.localeCompare(b.when));
    if (lines.length) {
      const fmt = (k) => new Date(`${k}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const saved = await db.from('command_heads_up').upsert({
        source: 'funding', source_id: `funding-week:${today}`, source_updated: today, title: 'Funding: the next 30 days',
        starts_at: `${today}T12:00:00Z`, all_day: true, location: null, join_link: null,
        heads_up: `${lines.length} start-by dates and deadlines coming up.`,
        prep: lines.slice(0, 20).map((l) => ({ text: noDashes(`${fmt(l.when)}: ${l.text}`).slice(0, 400), done: false })),
        has_news: true, updated_at: new Date().toISOString(),
      }, { onConflict: 'source_id' });
      if (!saved.error) weekly = true;
    }
  }
  return { checked: list.length, reminders: made, weekly };
}

// ---- Quick add: a program the founder heard about in passing ----------------------------------------------------------------
// They type a name, a link, or a note. Command finds the official page, reads it, and saves what it found.
// Open or upcoming programs go to Options. Closed ones are watched for their next round, with when they usually open.

function readable(html) {
  return String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#39;|&rsquo;/gi, "'").replace(/\s+/g, ' ').trim();
}

async function pageText(url, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(9000), headers: { Accept: 'text/html,application/xhtml+xml' } });
    if (!response.ok) return '';
    return readable((await response.text()).slice(0, 400000)).slice(0, 12000);
  } catch { return ''; }
}

export function lookupRules(settings = DEFAULT_SETTINGS) {
  return `You read search results and an official web page about ONE funding opportunity, for this company:
${fundingProfileText(settings)}

Find the official program and report only what the sources say. Never invent dates or amounts.
Return JSON only:
{"program_name": string, "organization": string or null, "official_url": string or null,
 "opportunity_type": one of grant|accelerator|pitch_competition|procurement|funding|fellowship|program|other,
 "amount_text": string or null (money offered), "benefits_text": string or null (what you get besides money: credits, mentoring, a program, perks),
 "funding_structure": one of grant|reimbursement|investment|credits|prize|other, "is_non_dilutive": boolean or null,
 "deadline": "YYYY-MM-DD" or null (the CURRENT round's deadline only),
 "round_status": one of open|upcoming|closed|rolling|unknown,
 "next_open": "YYYY-MM-DD" or null (when the next round is expected to open; only if the sources give a date or a clear yearly pattern, such as "every March"),
 "cycle_note": string or null (one plain sentence on how often it runs and when, from the sources),
 "eligibility": short string or null, "fit_label": one of very_high|high|medium|investigate, "fit_rationale": one plain sentence}`;
}

export async function lookupFunding(text, { now = new Date(), search = defaultSearch, ai = aiText, fetchImpl = fetch, settings = DEFAULT_SETTINGS } = {}) {
  const input = String(text || '').trim().slice(0, 500);
  if (!input) throw Object.assign(new Error('Type a program name, a link, or a note.'), { code: 'VALIDATION_ERROR', status: 400 });
  const today = easternToday(now);
  const year = new Date(now).getUTCFullYear();
  const link = input.match(/https?:\/\/\S+/)?.[0] || null;
  const words = input.replace(/https?:\/\/\S+/g, '').trim();
  let results = [];
  try { results = await search({ query: `${words || link} official application deadline ${year}`.trim(), maxResults: 6 }); } catch { results = []; }
  const officialUrl = link || results[0]?.url || null;
  const page = officialUrl ? await pageText(officialUrl, fetchImpl) : '';
  const user = `Today is ${today}. ${firstName(settings)} wrote: "${input}"

Search results:
${JSON.stringify((results || []).map((r) => ({ title: r.title, url: r.url, snippet: String(r.snippet || '').slice(0, 600) })), null, 1)}

Official page (${officialUrl || 'none'}):
${page || '(could not be read)'}`;
  const raw = await ai({ system: lookupRules(settings), user, tier: 'write', maxTokens: 1500 });
  const found = JSON.parse(String(raw || '').replace(/^[^{]*/, '').replace(/[^}]*$/, ''));
  return { found, officialUrl: found.official_url || officialUrl, today };
}

export async function quickAddFunding(db, text, deps = {}) {
  const settings = deps.settings || await founderSettings(db);
  const { found, officialUrl, today } = await lookupFunding(text, { ...deps, settings });
  const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);
  const deadline = date(found.deadline);
  const closed = found.round_status === 'closed' || (deadline && deadline < today);
  const payload = {
    program_name: noDashes(found.program_name || text).slice(0, 300),
    organization: found.organization ? noDashes(found.organization).slice(0, 300) : null,
    opportunity_type: TYPES.has(found.opportunity_type) ? found.opportunity_type : 'program',
    official_url: officialUrl || undefined,
    deadline: closed ? null : deadline,
    amount_text: found.amount_text ? String(found.amount_text).slice(0, 300) : undefined,
    funding_structure: STRUCTURES.has(found.funding_structure) ? found.funding_structure : undefined,
    is_non_dilutive: typeof found.is_non_dilutive === 'boolean' ? found.is_non_dilutive : undefined,
    eligibility: found.eligibility ? String(found.eligibility).slice(0, 2000) : undefined,
    fit_label: FITS.has(found.fit_label) ? found.fit_label : 'investigate',
    fit_rationale: found.fit_rationale ? String(found.fit_rationale).slice(0, 1000) : undefined,
    notes: `Added by ${firstName(settings)}: ${String(text).slice(0, 500)}`,
    source_type: 'quick_add',
  };
  if (!payload.official_url) delete payload.official_url;
  const saved = await ingestFundingWatch(payload, db);
  const id = saved.opportunity?.id;
  const extra = { benefits_text: found.benefits_text ? String(found.benefits_text).slice(0, 1000) : null, next_round_note: found.cycle_note ? noDashes(found.cycle_note).slice(0, 500) : null, next_open_at: date(found.next_open), last_checked_at: new Date().toISOString() };
  // A program that already closed is watched for its next round instead of sitting in Options.
  if (closed && saved.status === 'created') Object.assign(extra, { status: 'watching', funding_intent: null });
  if (id) {
    const updated = await db.from('crm_program_opportunities').update(extra).eq('id', id);
    if (updated.error) throw updated.error;
  }
  return {
    id, status: saved.status, watching: Boolean(closed),
    title: payload.program_name, organization: payload.organization, deadline: payload.deadline, amount: payload.amount_text || null,
    benefits: extra.benefits_text, next_open: extra.next_open_at, cycle: extra.next_round_note, url: officialUrl || null,
  };
}

// ---- Watching: closed programs are re-checked so a new round is caught when it opens --------------------------------
export async function checkWatchedFunding(db, { now = new Date(), limit = 6, ...deps } = {}) {
  if (!deps.settings) deps.settings = await founderSettings(db);
  const today = easternToday(now);
  const weekAgo = new Date(new Date(now).getTime() - 7 * 86400000).toISOString();
  const soon = new Date(new Date(`${today}T12:00:00Z`).getTime() + 21 * 86400000).toISOString().slice(0, 10);
  const rows = await db.from('crm_program_opportunities').select('id,title,organization,source_url,next_open_at,last_checked_at').eq('status', 'watching').limit(200);
  if (rows.error) throw rows.error;
  // Checked weekly, and every day once the expected opening is three weeks away or less.
  const due = (rows.data || []).filter((r) => !r.last_checked_at || r.last_checked_at < weekAgo || (r.next_open_at && r.next_open_at <= soon))
    .sort((a, b) => String(a.next_open_at || '9999').localeCompare(String(b.next_open_at || '9999'))).slice(0, limit);
  const summary = { checked: 0, reopened: 0, failed: 0 };
  for (const r of due) {
    summary.checked += 1;
    try {
      const { found } = await lookupFunding(`${r.title} ${r.organization || ''} ${r.source_url || ''}`, { now, ...deps });
      const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null);
      const deadline = date(found.deadline);
      const open = (found.round_status === 'open' || found.round_status === 'upcoming' || found.round_status === 'rolling') && (!deadline || deadline >= today);
      const patch = { last_checked_at: new Date().toISOString(), next_open_at: date(found.next_open) || r.next_open_at || null, ...(found.cycle_note ? { next_round_note: noDashes(found.cycle_note).slice(0, 500) } : {}) };
      if (open) Object.assign(patch, { status: 'discovered', funding_intent: 'option', deadline_at: deadline, ...(found.amount_text ? { amount_text: String(found.amount_text).slice(0, 300) } : {}) });
      const saved = await db.from('crm_program_opportunities').update(patch).eq('id', r.id);
      if (saved.error) throw saved.error;
      if (open) {
        summary.reopened += 1;
        const row = {
          source: 'funding', source_id: `funding-open:${r.id}:${deadline || today}`, source_updated: 'open', title: noDashes(`Open again: ${r.title}`).slice(0, 300),
          starts_at: `${today}T12:00:00Z`, all_day: true, join_link: r.source_url || null,
          heads_up: deadline ? `A new round is open. Deadline ${new Date(`${deadline}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}.` : 'A new round is open.',
          prep: [{ text: 'Open the application page.', done: false }, { text: 'Decide: apply, or mark it as a pass in the Funding Hub.', done: false }], has_news: true, updated_at: new Date().toISOString(),
        };
        const h = await db.from('command_heads_up').upsert(row, { onConflict: 'source_id', ignoreDuplicates: true });
        if (h.error) throw h.error;
      }
    } catch (error) { summary.failed += 1; console.error('[Funding watch]', error.message); }
  }
  return summary;
}
