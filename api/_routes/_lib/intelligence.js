import { routeAi, aiKey } from './ai.js';
import { DEFAULT_SETTINGS, companyContext } from './founder-settings.js';

export const INTELLIGENCE_SOURCES = [
  { id: 'openai', publisher: 'OpenAI', url: 'https://openai.com/blog/rss.xml', lane: 'ai_automation', sourceQuality: 'official', freshnessDays: 14 },
  { id: 'google-ai', publisher: 'Google AI', url: 'https://blog.google/technology/ai/rss/', lane: 'ai_automation', sourceQuality: 'official', freshnessDays: 14 },
  { id: 'vercel', publisher: 'Vercel', url: 'https://vercel.com/atom', lane: 'platform_watch', sourceQuality: 'official', freshnessDays: 14 },
  { id: 'search-engine-roundtable', publisher: 'Search Engine Roundtable', url: 'https://www.seroundtable.com/index.xml', lane: 'search_visibility', sourceQuality: 'industry', freshnessDays: 30 },
  { id: 'search-engine-journal', publisher: 'Search Engine Journal', url: 'https://www.searchenginejournal.com/feed/', lane: 'search_visibility', sourceQuality: 'industry', freshnessDays: 30 },
  { id: 'nist', publisher: 'NIST', url: 'https://www.nist.gov/news-events/news/rss.xml', lane: 'ai_governance', sourceQuality: 'government', freshnessDays: 60 },
];

const QUALITY_RANK = { official: 3, government: 3, industry: 2 };
const PRIORITY_RANK = { must_know: 3, important: 2, useful: 1 };
const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$)/i;

export function safeHttpUrl(value, baseUrl) {
  try {
    const url = new URL(String(value || '').trim(), baseUrl);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function canonicalizeUrl(value) {
  const safe = safeHttpUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  [...url.searchParams.keys()].forEach((key) => { if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key); });
  url.hash = '';
  url.searchParams.sort();
  return url.href;
}

function decodeXml(value = '') {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => String.fromCodePoint(parseInt(code.slice(0, 1).toLowerCase() === 'x' ? code.slice(1) : code, code[0].toLowerCase() === 'x' ? 16 : 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

export function textFromMarkup(value = '') {
  return decodeXml(value).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function tag(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
    if (match) return match[1];
  }
  return '';
}

function entryLink(block, feedUrl) {
  const links = [...block.matchAll(/<link(?:\s[^>]*)?\/?>(?:\s*<\/link>)?/gi)];
  for (const match of links) {
    const raw = match[0];
    const href = raw.match(/\bhref=["']([^"']+)["']/i)?.[1];
    const rel = raw.match(/\brel=["']([^"']+)["']/i)?.[1];
    if (href && (!rel || rel.toLowerCase().includes('alternate'))) return safeHttpUrl(decodeXml(href), feedUrl);
  }
  return safeHttpUrl(tag(block, ['guid', 'link']), feedUrl);
}

export function parseFeed(xml, source, now = new Date()) {
  const blocks = [...String(xml || '').matchAll(/<(item|entry)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi)].map((match) => match[0]);
  return blocks.map((block) => {
    const title = textFromMarkup(tag(block, ['title'])).slice(0, 300);
    const sourceUrl = canonicalizeUrl(entryLink(block, source.url));
    const dateText = textFromMarkup(tag(block, ['pubDate', 'published', 'updated', 'date']));
    const date = dateText ? new Date(dateText) : null;
    const sourceText = textFromMarkup(tag(block, ['description', 'summary', 'content', 'encoded'])).slice(0, 6000);
    if (!title || !sourceUrl || !date || Number.isNaN(date.getTime()) || !sourceText) return null;
    return { title, publisher: source.publisher, sourceUrl, publishedAt: date.toISOString(), retrievedAt: now.toISOString(), lane: source.lane, sourceQuality: source.sourceQuality, sourceText, fingerprint: fingerprint({ title, publisher: source.publisher, sourceUrl }) };
  }).filter(Boolean);
}

export function fingerprint({ title, publisher, sourceUrl }) {
  const normalizedTitle = String(title || '').toLowerCase().replace(/[^\da-z]+/gi, ' ').trim();
  return canonicalizeUrl(sourceUrl) || `${String(publisher || '').toLowerCase().trim()}::${normalizedTitle}`;
}

export function isFresh(item, source, now = new Date()) {
  const age = now.getTime() - new Date(item.publishedAt).getTime();
  return age >= 0 && age <= source.freshnessDays * 86400000;
}

export function dedupeItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    const urlKey = canonicalizeUrl(item.sourceUrl);
    const titleKey = `${String(item.publisher).toLowerCase().trim()}::${String(item.title).toLowerCase().replace(/[^\da-z]+/gi, ' ').trim()}`;
    if (seen.has(urlKey) || seen.has(titleKey)) return false;
    seen.add(urlKey); seen.add(titleKey); return true;
  });
}

export async function fetchSource(source, { fetchImpl = fetch, now = new Date() } = {}) {
  const response = await fetchImpl(source.url, { headers: { accept: 'application/rss+xml, application/atom+xml, text/xml' } });
  if (!response.ok) throw new Error(`Source returned ${response.status}`);
  return parseFeed(await response.text(), source, now).filter((item) => isFresh(item, source, now));
}

function parseJsonText(value) {
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(text); } catch { return null; }
}

export async function classifyItem(item, { apiKey = aiKey(), fetchImpl = fetch, settings = DEFAULT_SETTINGS } = {}) {
  if (!apiKey) return null;
  const prompt = JSON.stringify({ title: item.title, publisher: item.publisher, publishedAt: item.publishedAt, sourceUrl: item.sourceUrl, lane: item.lane, sourceText: item.sourceText.slice(0, 6000), companyContext: companyContext(settings) });
  const response = await routeAi(fetchImpl)('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 220, system: 'Classify only from the supplied public source. Return JSON only with priority (must_know, important, useful, irrelevant), whyItMatters (one or two short grounded sentences), and lane. Do not invent facts.', messages: [{ role: 'user', content: prompt }] }) });
  if (!response.ok) return null;
  const data = await response.json();
  const result = parseJsonText(data.content?.filter((block) => block.type === 'text').map((block) => block.text).join(''));
  if (!result || !Object.hasOwn(PRIORITY_RANK, result.priority) || result.lane !== item.lane || typeof result.whyItMatters !== 'string' || !result.whyItMatters.trim() || result.whyItMatters.length > 360) return null;
  return { ...item, priority: result.priority, whyItMatters: result.whyItMatters.trim() };
}

export async function buildRadarResult({ fetchImpl = fetch, anthropicApiKey = aiKey(), now = new Date(), settings = DEFAULT_SETTINGS } = {}) {
  const settled = await Promise.all(INTELLIGENCE_SOURCES.map(async (source) => { try { return { source, items: await fetchSource(source, { fetchImpl, now }) }; } catch { return { source, items: null }; } }));
  const failedSources = settled.filter((entry) => entry.items === null).map((entry) => entry.source.publisher);
  const candidates = dedupeItems(settled.flatMap((entry) => entry.items || []).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)).slice(0, 30));
  const classified = (await Promise.all(candidates.map((item) => classifyItem(item, { apiKey: anthropicApiKey, fetchImpl, settings })))).filter(Boolean).filter((item) => item.priority !== 'irrelevant');
  classified.sort((a, b) => (PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]) || (QUALITY_RANK[b.sourceQuality] - QUALITY_RANK[a.sourceQuality]) || (new Date(b.publishedAt) - new Date(a.publishedAt)));
  return { items: classified.slice(0, 10).map(({ sourceText, fingerprint: itemFingerprint, ...item }) => item), refreshedAt: now.toISOString(), sourcesChecked: INTELLIGENCE_SOURCES.length - failedSources.length, failedSources, partialFailure: failedSources.length > 0 && failedSources.length < INTELLIGENCE_SOURCES.length, allSourcesFailed: failedSources.length === INTELLIGENCE_SOURCES.length };
}
