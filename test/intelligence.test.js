import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { createCommandSession } from '../api/_lib/auth.js';
import radarHandler from '../api/intelligence/radar.js';
import { companyContext } from '../api/_lib/founder-settings.js';
import { SAMPLE } from './fixtures/founder.js';
import { INTELLIGENCE_SOURCES, buildRadarResult, canonicalizeUrl, classifyItem, dedupeItems, isFresh, parseFeed, safeHttpUrl } from '../api/_lib/intelligence.js';

function response() { return { statusCode: 200, payload: null, status(code) { this.statusCode = code; return this; }, json(value) { this.payload = value; return this; } }; }
function feed(title = 'Important update', link = 'https://example.com/story?utm_source=x#part', date = 'Wed, 27 Aug 2026 12:00:00 GMT') { return `<rss><channel><item><title>${title}</title><link>${link}</link><pubDate>${date}</pubDate><description><![CDATA[Public source details about this update.]]></description></item></channel></rss>`; }

test.beforeEach(() => { process.env.COMMAND_SESSION_SECRET = 'test-session-secret-with-at-least-thirty-two-characters'; });
test.after(() => { delete process.env.COMMAND_SESSION_SECRET; });

test('Radar registry is small, curated, and uses safe HTTP(S) endpoints', () => {
  assert.ok(INTELLIGENCE_SOURCES.length >= 5 && INTELLIGENCE_SOURCES.length <= 20);
  assert.ok(INTELLIGENCE_SOURCES.every((source) => /^https:\/\//.test(source.url)));
  assert.ok(INTELLIGENCE_SOURCES.every((source) => ['ai_automation', 'platform_watch', 'search_visibility', 'ai_governance', 'entrepreneurship_funding'].includes(source.lane)));
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpUrl('data:text/html,unsafe'), null);
  assert.equal(safeHttpUrl('file:///tmp/x'), null);
  assert.equal(safeHttpUrl('https://example.com/a'), 'https://example.com/a');
});

test('feed normalization preserves safe display fields and canonicalizes URLs', () => {
  const item = parseFeed(feed(), { url: 'https://example.com/feed', publisher: 'Example', lane: 'platform_watch', sourceQuality: 'official' }, new Date('2026-08-28T12:00:00Z'))[0];
  assert.deepEqual(Object.keys(item).sort(), ['fingerprint', 'lane', 'publishedAt', 'publisher', 'retrievedAt', 'sourceQuality', 'sourceText', 'sourceUrl', 'title'].sort());
  assert.equal(item.sourceUrl, 'https://example.com/story');
  assert.equal(item.publisher, 'Example');
  assert.equal(item.title, 'Important update');
  assert.equal(item.sourceText, 'Public source details about this update.');
  assert.equal(item.retrievedAt, '2026-08-28T12:00:00.000Z');
});

test('dedupe removes tracking/fragment URL duplicates and exact publisher-title duplicates', () => {
  assert.equal(canonicalizeUrl('https://example.com/a?gclid=1&utm_medium=x&b=2#x'), 'https://example.com/a?b=2');
  const items = [{ publisher: 'A', title: 'Same story', sourceUrl: 'https://example.com/a?utm_source=x' }, { publisher: 'A', title: 'Other title', sourceUrl: 'https://example.com/a' }, { publisher: 'A', title: 'Same story', sourceUrl: 'https://example.com/b' }];
  assert.equal(dedupeItems(items).length, 1);
});

test('freshness uses the source lane window and excludes stale or future items', () => {
  const source = { freshnessDays: 30 };
  const now = new Date('2026-08-28T12:00:00Z');
  assert.equal(isFresh({ publishedAt: '2026-08-10T12:00:00Z' }, source, now), true);
  assert.equal(isFresh({ publishedAt: '2026-07-01T12:00:00Z' }, source, now), false);
  assert.equal(isFresh({ publishedAt: '2026-08-29T12:00:00Z' }, source, now), false);
});

test('structured classification accepts only grounded approved output and bounds source text', async () => {
  let request;
  const item = parseFeed(feed(), { url: 'https://example.com/feed', publisher: 'Example', lane: 'platform_watch', sourceQuality: 'official' }, new Date('2026-08-28T12:00:00Z'))[0];
  const result = await classifyItem(item, {
    apiKey: 'test-key',
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body);
      return { ok: true, json: async () => ({ content: [{ type: 'text', text: '{"priority":"important","whyItMatters":"This may affect Atara platform decisions.","lane":"platform_watch"}' }] }) };
    },
  });
  assert.equal(result.priority, 'important');
  assert.equal(result.lane, 'platform_watch');
  assert.equal(request.messages[0].content.includes('COMMAND'), false);
  assert.match(request.messages[0].content, /materially affect its products/);
  assert.ok(request.messages[0].content.length < 7000);
  const invalid = await classifyItem(item, {
    apiKey: 'test-key',
    fetchImpl: async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: '{"priority":"urgent","whyItMatters":"bad","lane":"platform_watch"}' }] }) }),
  });
  assert.equal(invalid, null);
});

test('Radar build handles partial and total source failure without fabricated items', async () => {
  let calls = 0;
  const partial = await buildRadarResult({ anthropicApiKey: '', now: new Date('2026-08-28T12:00:00Z'), fetchImpl: async (url) => { calls += 1; if (url === INTELLIGENCE_SOURCES[0].url) return { ok: true, text: async () => feed() }; throw new Error('unavailable'); } });
  assert.equal(calls, INTELLIGENCE_SOURCES.length);
  assert.equal(partial.partialFailure, true);
  assert.equal(partial.items.length, 0);
  const total = await buildRadarResult({ anthropicApiKey: '', fetchImpl: async () => { throw new Error('unavailable'); } });
  assert.equal(total.allSourcesFailed, true);
  assert.deepEqual(total.items, []);
});

test('unauthenticated Radar request is rejected before external retrieval', async () => {
  const originalFetch = global.fetch; let called = false; global.fetch = async () => { called = true; throw new Error('must not fetch'); };
  try { const res = response(); await radarHandler({ method: 'GET', headers: {} }, res); assert.equal(res.statusCode, 401); assert.equal(called, false); } finally { global.fetch = originalFetch; }
});

test('authenticated Radar route is read-only and returns normalized classified items', async () => {
  const originalFetch = global.fetch; const originalKey = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'test-key'; const calls = [];
  global.fetch = async (url, options = {}) => { calls.push({ url, options }); if (url === 'https://api.anthropic.com/v1/messages') return { ok: true, json: async () => ({ content: [{ type: 'text', text: '{"priority":"useful","whyItMatters":"Useful context for Atara planning.","lane":"' + (JSON.parse(options.body).messages[0].content.match(/"lane":"([^"]+)/)?.[1] || 'platform_watch') + '"}' }] }) }; return { ok: true, text: async () => feed('Verified item', url + '/item', 'Wed, 27 Aug 2026 12:00:00 GMT') }; };
  try { const res = response(); await radarHandler({ method: 'GET', headers: { cookie: `atara_command_session=${createCommandSession()}` } }, res); assert.equal(res.statusCode, 200); assert.equal(res.payload.ok, true); assert.ok(res.payload.data.items.length <= 10); assert.ok(res.payload.data.items.every((item) => !('sourceText' in item) && item.sourceUrl.startsWith('https://'))); assert.ok(calls.every(({ url }) => INTELLIGENCE_SOURCES.some((source) => source.url === url) || url === 'https://api.anthropic.com/v1/messages')); } finally { global.fetch = originalFetch; if (originalKey) process.env.ANTHROPIC_API_KEY = originalKey; else delete process.env.ANTHROPIC_API_KEY; }
});

test('founder UI exposes Intelligence refresh without persistence or Scout/CRM crossover', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /News radar/); assert.match(html, /Refresh Intelligence/); assert.match(html, /api\/intelligence\/radar/); assert.match(html, /Checking important developments/); assert.match(html, /Open Article/); assert.match(html, /noopener noreferrer/);
  assert.doesNotMatch(html, /intelligence-(save|dismiss|work|knowledge)/i);
  assert.match(html, /mobileNavGo\('panel-intelligence'\)/);
  assert.match(html, /id="intelligence-list"[^>]*class="intelligence-list"/);
  assert.match(html, /function safeIntelligenceUrl/);
  assert.equal(companyContext(SAMPLE).includes('CRM contacts'), false);
  assert.match(companyContext(SAMPLE), /Northwind Orders/);
  assert.doesNotMatch(companyContext(SAMPLE), /Atara|SCOPE|SpectrumThrive/);
});
