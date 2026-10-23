// Everything personal to the founder lives here, in the command_settings table, one row per section.
// The setup assistant fills it in by asking plain questions; any section can be redone later.
// Every AI helper reads these settings, so nothing about the founder is written into the code.

import { configureEmailStyle } from './email-style.js';

export const SETTINGS_TABLE = 'command_settings';

export const SECTIONS = ['founder', 'company', 'brands', 'audience', 'funding', 'schedule', 'voice', 'links', 'assistant', 'modules'];

export const DEFAULT_SETTINGS = Object.freeze({
  founder: { name: '', first_name: '', title: 'Founder', email: '', signoff: '', bio: '' },
  company: {
    name: '', short_name: '', legal_name: '', entity_type: '', state: '', founded: '', one_liner: '', mission: '',
    website: '', contact_email: '', facts: '', private_topics: 'User counts, revenue, funding details and application status. Internal tools, vendors and how anything is built.',
  },
  // list: [{ code: 'AB', name: 'Brand name', one_liner: '', facts: '', audience: '' }]
  brands: { list: [] },
  // news_topics: short search phrases for Know it news and the news radar, such as "bakery industry".
  audience: { who: '', problems: '', beliefs: '', frameworks: '', offers: '', news_topics: [] },
  funding: {
    stage: '', revenue: '', location: '', regions: '', founder_background: '', eligible_groups: '', programs_won: '',
    credentials: '', search_queries: [], federal_keywords: [],
  },
  schedule: { time_zone: '', workdays: [1, 2, 3, 4, 5], rest_days: [0], weekly_review_day: 5, linkedin_post_days: [1, 3, 5] },
  voice: {
    rules: 'Warm, direct and plain. Short sentences. Sounds like a real person, never a sales script.\nNo hype, no buzzwords, no fake urgency.\nNever guess what other people think or feel.\nNever invent facts, numbers, results or promises. If something is unknown, leave a [square bracket] for the founder to fill in.',
    samples: '', banned_words: [], no_dashes: false, reading_level: '',
  },
  links: { booking_url: '', booking_label: 'intro call', demo_url: '', linkedin_url: '' },
  assistant: { name: 'River' },
  // Areas a founder can switch on or off. Money starts off so it stays private until they want it.
  modules: { money: false, updates: true, linkedin: true, funding: true, know: true },
});

const CACHE_MS = 60_000;
let cache = null;
// The last time zone read from setup, so plain date math (which cannot wait for the database) uses it too.
let knownZone = '';
let knownFirstName = '';

export function clearSettingsCache() { cache = null; }

export function validZone(zone) {
  if (!zone) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true; } catch { return false; }
}

function merge(section, value) {
  const base = DEFAULT_SETTINGS[section];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return structuredClone(base);
  return { ...structuredClone(base), ...value };
}

export function settingsFromRows(rows = []) {
  const bySection = Object.fromEntries((rows || []).map((r) => [r.section, r.value]));
  const out = Object.fromEntries(SECTIONS.map((s) => [s, merge(s, bySection[s])]));
  out.completed = (rows || []).filter((r) => r.completed_at).map((r) => r.section);
  return out;
}

// Reads all settings. A missing table or empty database still returns the defaults, so Command keeps working
// on first run before the setup assistant has saved anything.
export async function founderSettings(db, { fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  let rows = [];
  try {
    const result = await db.from(SETTINGS_TABLE).select('section,value,completed_at');
    if (!result.error) rows = result.data || [];
  } catch { rows = []; }
  const value = settingsFromRows(rows);
  configureEmailStyle({ noDashes: Boolean(value.voice.no_dashes) });
  knownZone = validZone(value.schedule.time_zone) ? value.schedule.time_zone : '';
  if (knownZone) globalThis.CMD_TZ = knownZone; // shared browser/server helpers (attention.js) read this
  knownFirstName = value.founder.first_name || String(value.founder.name || '').trim().split(/\s+/)[0] || '';
  if (knownFirstName) globalThis.CMD_FIRST_NAME = knownFirstName;
  cache = { at: Date.now(), value };
  return value;
}

export async function saveSection(db, section, value, { complete = true } = {}) {
  if (!SECTIONS.includes(section)) throw Object.assign(new Error(`Unknown settings section: ${section}`), { code: 'VALIDATION_ERROR' });
  const clean = merge(section, value);
  const result = await db.from(SETTINGS_TABLE).upsert({
    section, value: clean, completed_at: complete ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
  }, { onConflict: 'section' }).select('section,value,completed_at').single();
  if (result.error) throw result.error;
  clearSettingsCache();
  return result.data;
}

// ---------- Helpers every part of Command uses ----------

export function timeZone(settings) {
  return (validZone(settings?.schedule?.time_zone) && settings.schedule.time_zone) || envTimeZone();
}

// Plain date math reads the zone from setup once settings have loaded on this request, else the deploy setting.
// The founder's first name from the last settings load, for code that matches names without waiting on the database.
export function cachedFirstName() { return knownFirstName; }

export function envTimeZone() { return knownZone || process.env.COMMAND_TIME_ZONE || 'America/New_York'; }

export function firstName(settings) {
  const f = settings?.founder || {};
  return f.first_name || String(f.name || '').trim().split(/\s+/)[0] || 'the founder';
}

export function companyName(settings) {
  const c = settings?.company || {};
  return c.short_name || c.name || c.legal_name || 'the company';
}

export function brandList(settings) {
  return (settings?.brands?.list || []).filter((b) => b && (b.name || b.code));
}

export function brandCodes(settings) {
  return brandList(settings).map((b) => String(b.code || b.name).toUpperCase().slice(0, 12));
}

export function cleanText(settings, text) {
  let out = String(text ?? '');
  if (settings?.voice?.no_dashes) out = out.replace(/\s*[—–]\s*/g, ', ').replace(/\s--\s/g, ', ');
  return out;
}

function lines(label, value) {
  const text = Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value || '').trim();
  return text ? `- ${label}: ${text}` : '';
}

function block(title, rows) {
  const body = rows.filter(Boolean).join('\n');
  return body ? `${title}\n${body}` : '';
}

export function voiceText(settings) {
  const v = settings?.voice || {};
  const name = firstName(settings);
  const rules = String(v.rules || '').split('\n').map((r) => r.trim()).filter(Boolean).map((r) => (r.startsWith('-') ? r : `- ${r}`));
  if (v.no_dashes) rules.push('- No em dashes, en dashes or double hyphens.');
  if (v.reading_level) rules.push(`- Write at a ${v.reading_level} reading level.`);
  if (v.banned_words?.length) rules.push(`- Never use these words or phrases: ${v.banned_words.join(', ')}.`);
  const samples = String(v.samples || '').trim();
  return [
    `HOW ${name.toUpperCase()} WRITES`,
    ...rules,
    samples ? `\nSAMPLES OF ${name.toUpperCase()}'S REAL WRITING (match this voice; never copy the content)\n${samples.slice(0, 4000)}` : '',
  ].filter(Boolean).join('\n');
}

// The picture every AI helper starts from. Built only from what the founder entered in setup.
export function knowledgeText(settings) {
  const f = settings?.founder || {};
  const c = settings?.company || {};
  const l = settings?.links || {};
  const a = settings?.audience || {};
  const name = firstName(settings);
  const parts = [
    block(`ABOUT ${name.toUpperCase()}`, [
      f.name ? `- ${f.name}${f.title ? `, ${f.title}` : ''}${c.name ? ` of ${c.name}` : ''}.` : '',
      f.bio ? String(f.bio).split('\n').filter(Boolean).map((r) => (r.startsWith('-') ? r : `- ${r}`)).join('\n') : '',
    ]),
    block(`COMPANY: ${c.name || 'not entered yet'}`, [
      c.one_liner ? `- ${c.one_liner}` : '',
      lines('Mission', c.mission),
      lines('Where', [c.state, c.entity_type].filter(Boolean).join(', ')),
      lines('Founded', c.founded),
      lines('Website', c.website),
      lines('Contact', c.contact_email),
      c.facts ? String(c.facts).split('\n').filter(Boolean).map((r) => (r.startsWith('-') ? r : `- ${r}`)).join('\n') : '',
    ]),
    ...brandList(settings).map((b) => block(`BRAND OR PRODUCT: ${b.name || b.code}`, [
      b.one_liner ? `- ${b.one_liner}` : '',
      lines('For', b.audience),
      b.facts ? String(b.facts).split('\n').filter(Boolean).map((r) => (r.startsWith('-') ? r : `- ${r}`)).join('\n') : '',
    ])),
    block('WHO THEY SERVE', [lines('People', a.who), lines('Their problems', a.problems), lines('Offers', a.offers)]),
    block('LINKS', [
      l.booking_url ? `- ${l.booking_label || 'Intro call'} booking link: ${l.booking_url}. Offer it when someone wants to connect and a short call fits.` : '',
      l.demo_url ? `- Demo link (only for investors and partners, never public posts): ${l.demo_url}` : '',
      lines('LinkedIn', l.linkedin_url),
    ]),
    block('WHAT NOT TO SHARE', [c.private_topics ? `- ${c.private_topics}` : '', '- Never promise a partnership, price, date or free offer that is not written above.']),
    voiceText(settings),
  ];
  return parts.filter(Boolean).join('\n\n');
}

export function fundingProfileText(settings) {
  const c = settings?.company || {};
  const fu = settings?.funding || {};
  return [
    lines('Company', [c.legal_name || c.name, c.entity_type, c.state].filter(Boolean).join(', ')),
    lines('What it does', c.one_liner),
    lines('Products', brandList(settings).map((b) => `${b.name}${b.one_liner ? ` (${b.one_liner})` : ''}`)),
    lines('Stage', fu.stage),
    lines('Revenue', fu.revenue),
    lines('Location', fu.location || c.state),
    lines('Founder background', fu.founder_background),
    lines('Groups the founder belongs to (for eligibility)', fu.eligible_groups),
    lines('Programs already won or joined', fu.programs_won),
    lines('Registrations and credentials', fu.credentials),
  ].filter(Boolean).join('\n') || '- No funding profile yet. Ask the founder to finish the Funding section of setup.';
}

export function fundingRegions(settings) {
  return String(settings?.funding?.regions || settings?.funding?.location || settings?.company?.state || '').trim();
}

// Search queries for the Funding Scout. The founder's own list wins; otherwise build a few from the profile.
export function fundingQueries(settings) {
  const own = (settings?.funding?.search_queries || []).map((q) => String(q).trim()).filter(Boolean);
  if (own.length) return own;
  const year = new Date().getUTCFullYear();
  const where = fundingRegions(settings);
  const field = settings?.company?.one_liner || brandList(settings)[0]?.one_liner || 'small business';
  const groups = String(settings?.funding?.eligible_groups || '').split(/[,;\n]/).map((g) => g.trim()).filter(Boolean).slice(0, 3);
  return [
    `small business grants ${where} ${year}`.trim(),
    `startup grant non-dilutive ${where} ${year}`.trim(),
    `accelerator applications open ${year} ${field}`.slice(0, 120),
    `pitch competition ${where} ${year}`.trim(),
    ...groups.map((g) => `grants for ${g} founders ${year}`),
  ];
}

export function linkedinTopics(settings) {
  const brands = brandList(settings).slice(0, 3);
  const topics = Object.fromEntries(brands.map((b) => [String(b.code || b.name).toLowerCase().replace(/[^a-z0-9]+/g, '_'), `${b.name}${b.audience ? ` (for ${b.audience})` : ''}`]));
  topics.founder = `the founder story building ${companyName(settings)}`;
  return topics;
}

export function linkedinBrainDefault(settings) {
  const a = settings?.audience || {};
  const l = settings?.links || {};
  return [
    `WHO I WANT TO REACH (and what keeps them up at night)\n${a.who || '[who you serve]'}\n${a.problems ? `Their problems: ${a.problems}` : ''}`.trim(),
    `MY FRAMEWORKS (named methods I can teach)\n${a.frameworks || '[add a method you teach]'}`,
    `WHAT I BELIEVE THAT OTHERS DO NOT\n${a.beliefs || '[add your own]'}`,
    `OFFERS AND DM TRIGGERS\n${a.offers || '[an offer and the word people DM you for it]'}${l.booking_url ? `\n- Anyone who wants to connect: a ${l.booking_label || 'intro call'}.` : ''}`,
  ].join('\n\n');
}

// Know it news searches: the founder's own topics, plus AI news.
export function newsQueries(settings = DEFAULT_SETTINGS) {
  const own = (settings?.audience?.news_topics || []).map((t) => String(t).trim()).filter(Boolean).slice(0, 5);
  const field = settings?.company?.one_liner ? [String(settings.company.one_liner).slice(0, 80)] : [];
  const topics = (own.length ? own : field).map((q) => ({ topic: 'Industry news', q }));
  return [...topics, { topic: 'AI news', q: 'AI for small business' }, { topic: 'AI news', q: 'OpenAI OR Anthropic OR Google Gemini announcement' }];
}

// One plain paragraph about the company, for anything that judges whether news matters to it.
export function companyContext(settings = DEFAULT_SETTINGS) {
  const c = settings?.company || {};
  const brands = brandList(settings).map((b) => `${b.name}${b.one_liner ? ` (${b.one_liner})` : ''}`);
  const parts = [
    `${c.name || 'The company'}${c.one_liner ? `: ${c.one_liner}` : ''}.`,
    brands.length ? `Its products and brands: ${brands.join('; ')}.` : '',
    settings?.audience?.who ? `It serves ${settings.audience.who}.` : '',
    'Evaluate developments based on whether they materially affect its products, technology choices, customer demand, positioning, compliance or strategy.',
  ];
  return parts.filter(Boolean).join(' ');
}

// Which setup sections are still empty, in the order the setup assistant asks them.
export const SETUP_ORDER = ['founder', 'company', 'brands', 'audience', 'funding', 'schedule', 'voice', 'links'];
export function setupStatus(settings) {
  const done = new Set(settings?.completed || []);
  return SETUP_ORDER.map((section) => ({ section, done: done.has(section) }));
}
