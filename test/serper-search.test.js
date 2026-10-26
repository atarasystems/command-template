import test from 'node:test';
import assert from 'node:assert/strict';
import { searchLeads } from '../api/_routes/_lib/web-search.js';

test('lead searches use Serper when its key is set', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { ok: true, json: async () => ({ organic: [{ title: 'Bright Web Agency', link: 'https://brightweb.example/?utm_source=x', snippet: 'GoHighLevel agency in Austin' }] }) }; };
  const results = await searchLeads({ query: 'gohighlevel agency austin', serperApiKey: 'k', fetchImpl });
  assert.equal(seen.url, 'https://google.serper.dev/search');
  assert.equal(seen.init.headers['X-API-KEY'], 'k');
  assert.equal(results[0].url, 'https://brightweb.example/');
});

test('lead searches fall back to Tavily without a Serper key', async () => {
  let seen;
  const fetchImpl = async (url) => { seen = url; return { ok: true, json: async () => ({ results: [{ title: 'A', url: 'https://a.example', content: 'x' }] }) }; };
  await searchLeads({ query: 'web design agency', serperApiKey: '', apiKey: 't', fetchImpl });
  assert.equal(seen, 'https://api.tavily.com/search');
});
