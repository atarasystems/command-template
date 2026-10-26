// Web search through Google, using the Gemini key Command already has.
// Gemini runs the Google search and lists the pages it found. Every link is opened before it is kept,
// so a made-up or dead link never reaches Funding.
import { GEMINI_FAST_MODEL, geminiKey } from './ai.js';
import { canonicalPublicUrl } from './web-search.js';

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODELS = () => [GEMINI_FAST_MODEL(), 'gemini-3.1-flash-lite', 'gemini-3.8-flash'].filter((m, i, a) => a.indexOf(m) === i);

async function liveLink(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { Accept: 'text/html,application/xhtml+xml' } });
    return response.status < 400 || response.status === 403;
  } catch { return false; }
}

export function parseResultList(text) {
  const raw = String(text || '').replace(/^[^[]*/, '').replace(/[^\]]*$/, '');
  try {
    const list = JSON.parse(raw || '[]');
    return (Array.isArray(list) ? list : []).filter((r) => r && typeof r.url === 'string' && typeof r.title === 'string');
  } catch { return []; }
}

export async function searchGoogle({ query, maxResults = 6, fetchImpl = fetch } = {}) {
  if (!geminiKey()) { const error = new Error('Gemini is not connected'); error.code = 'GEMINI_NOT_CONNECTED'; throw error; }
  const prompt = `Search Google for: ${query}

From the search results, list up to ${maxResults} pages. Prefer the official page for one specific program (its own application or program page), not news stories or lists of many programs.
Use only links that appeared in the search results. Return JSON only: an array of {"title": string, "url": string, "snippet": "2 or 3 sentences on what the page says, including any deadline, amount and who can apply"}.`;
  let last = null;
  for (const model of MODELS()) {
    const response = await fetchImpl(`${GEMINI_API}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey() },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { temperature: 0.1, maxOutputTokens: 2000 } }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { last = `Google search through Gemini failed with status ${response.status}`; if (response.status === 404) continue; break; }
    const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
    const found = [];
    for (const r of parseResultList(text).slice(0, maxResults)) {
      let url; try { url = canonicalPublicUrl(r.url); } catch { continue; }
      if (/vertexaisearch\.cloud\.google\.com/.test(url)) continue;
      found.push({ title: String(r.title).slice(0, 300), url, snippet: String(r.snippet || '').slice(0, 700) });
    }
    const checks = await Promise.all(found.map((r) => liveLink(r.url, fetchImpl)));
    return found.filter((_, i) => checks[i]);
  }
  throw new Error(last || 'Google search through Gemini failed');
}

// Funding search: Serper (real Google results with real links) first, then Tavily, then Gemini as the last fallback.
export async function fundingSearch(args, { tavily, serper, env = process.env } = {}) {
  const tries = [];
  if (env.SERPER_API_KEY && serper) tries.push(() => serper({ ...args, apiKey: env.SERPER_API_KEY }));
  if (env.TAVILY_API_KEY && tavily) tries.push(() => tavily(args));
  if (geminiKey()) tries.push(() => searchGoogle(args));
  let last = null;
  for (const run of tries) {
    try { const found = await run(); if (found && found.length) return found; last = last || null; } catch (error) { last = error; }
  }
  if (last) throw last;
  return [];
}
