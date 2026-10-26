import { isIP } from 'node:net';

const TAVILY_ENDPOINT = 'https://api.tavily.com/search';
const MAX_QUERY_LENGTH = 300;
const MAX_RESULTS = 10;
const DEFAULT_TIMEOUT_MS = 8000;

function validationError(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  return error;
}

function isPrivateHost(value) {
  const host = String(value || '').replace(/^\[|\]$/g, '').toLowerCase();
  const version = isIP(host);
  if (version === 6) return host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb');
  if (version !== 4) return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal');
  const octets = host.split('.').map(Number);
  return octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) || (octets[0] === 198 && octets[1] === 18);
}

export function canonicalPublicUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw validationError('A valid public HTTP or HTTPS URL is required'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw validationError('Only HTTP and HTTPS URLs are allowed');
  if (url.username || url.password) throw validationError('Credential-bearing URLs are not allowed');
  const host = url.hostname.toLowerCase();
  if (isPrivateHost(host)) {
    throw validationError('Private or local URLs are not allowed');
  }
  url.hostname = host;
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_[a-z]+|gclid|fbclid|msclkid|ref|source)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
  return url.href;
}

function withTimeout(timeoutMs, externalSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (externalSignal) externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export async function searchWeb({ query, maxResults = 10, searchDepth = 'basic', apiKey = process.env.TAVILY_API_KEY, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > MAX_QUERY_LENGTH) throw validationError('A bounded search query is required');
  if (!apiKey) { const error = new Error('Tavily search is not configured'); error.code = 'TAVILY_NOT_CONFIGURED'; throw error; }
  const boundedResults = Math.max(1, Math.min(MAX_RESULTS, Number(maxResults) || MAX_RESULTS));
  if (!['basic', 'advanced', 'fast', 'ultra-fast'].includes(searchDepth)) throw validationError('Unsupported Tavily search depth');
  const timeout = withTimeout(timeoutMs);
  try {
    const response = await fetchImpl(TAVILY_ENDPOINT, {
      method: 'POST',
      signal: timeout.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ query: query.trim(), search_depth: searchDepth, max_results: boundedResults, include_answer: false, include_raw_content: false }),
    });
    if (!response.ok) { const error = new Error(`Tavily search failed with status ${response.status}`); error.code = 'TAVILY_REQUEST_FAILED'; throw error; }
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.results)) { const error = new Error('Tavily returned an invalid result set'); error.code = 'TAVILY_RESPONSE_INVALID'; throw error; }
    return payload.results.slice(0, boundedResults).map((item) => {
      let url = null;
      try { url = canonicalPublicUrl(item?.url); } catch { return null; }
      return { title: String(item?.title || '').trim().slice(0, 500), url, snippet: String(item?.content || item?.snippet || '').trim().slice(0, 3000), score: Number.isFinite(Number(item?.score)) ? Number(item.score) : null, published_date: item?.published_date || item?.publishedDate || null };
    }).filter((item) => item?.title && item.url);
  } finally { timeout.clear(); }
}

// Serper (Google results) for the lead finder, so its daily searches use their own allowance and Tavily is kept for funding.
const SERPER_ENDPOINT = 'https://google.serper.dev/search';

export async function searchSerper({ query, maxResults = 10, apiKey = process.env.SERPER_API_KEY, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > MAX_QUERY_LENGTH) throw validationError('A bounded search query is required');
  if (!apiKey) { const error = new Error('Serper search is not configured'); error.code = 'SERPER_NOT_CONFIGURED'; throw error; }
  const boundedResults = Math.max(1, Math.min(MAX_RESULTS, Number(maxResults) || MAX_RESULTS));
  const timeout = withTimeout(timeoutMs);
  try {
    const response = await fetchImpl(SERPER_ENDPOINT, {
      method: 'POST',
      signal: timeout.signal,
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
      body: JSON.stringify({ q: query.trim(), num: boundedResults }),
    });
    if (!response.ok) { const error = new Error(`Serper search failed with status ${response.status}`); error.code = 'SERPER_REQUEST_FAILED'; throw error; }
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.organic)) { const error = new Error('Serper returned an invalid result set'); error.code = 'SERPER_RESPONSE_INVALID'; throw error; }
    return payload.organic.slice(0, boundedResults).map((item) => {
      let url = null;
      try { url = canonicalPublicUrl(item?.link); } catch { return null; }
      return { title: String(item?.title || '').trim().slice(0, 500), url, snippet: String(item?.snippet || '').trim().slice(0, 3000), score: null, published_date: item?.date || null };
    }).filter((item) => item?.title && item.url);
  } finally { timeout.clear(); }
}

// Lead searches: Serper when its key is set, Tavily otherwise.
export function leadSearchReady() { return Boolean(process.env.SERPER_API_KEY || process.env.TAVILY_API_KEY); }
export async function searchLeads({ apiKey, serperApiKey = process.env.SERPER_API_KEY, ...rest } = {}) {
  if (serperApiKey) return searchSerper({ ...rest, apiKey: serperApiKey });
  return searchWeb({ ...rest, apiKey });
}

export { TAVILY_ENDPOINT, SERPER_ENDPOINT, MAX_RESULTS };
