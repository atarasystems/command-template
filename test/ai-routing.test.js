import assert from 'node:assert/strict';
import test from 'node:test';
import { routeAi, aiText, geminiModelFor } from '../api/_lib/ai.js';

function withEnv(env, fn) {
  const saved = { GEMINI_API_KEY: process.env.GEMINI_API_KEY, AI_PROVIDER: process.env.AI_PROVIDER };
  Object.assign(process.env, env);
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
  return Promise.resolve(fn()).finally(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

const anthropicBody = (model) => JSON.stringify({ model, max_tokens: 300, system: 'Be brief.', messages: [{ role: 'user', content: 'Hi' }] });

test('with a Gemini key, Claude requests go to Gemini and come back in the same shape', () => withEnv({ GEMINI_API_KEY: 'g', AI_PROVIDER: undefined }, async () => {
  const calls = [];
  const fake = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), key: init.headers['x-goog-api-key'] }); return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Hello' }] }, finishReason: 'STOP' }] }) }; };
  const res = await routeAi(fake)('https://api.anthropic.com/v1/messages', { method: 'POST', body: anthropicBody('claude-sonnet-4-6') });
  const data = await res.json();
  assert.equal(data.content[0].text, 'Hello');
  assert.match(calls[0].url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.8-flash:generateContent/);
  assert.equal(calls[0].key, 'g');
  assert.equal(calls[0].body.systemInstruction.parts[0].text, 'Be brief.');
  assert.equal(geminiModelFor('claude-haiku-4-5-20251001'), 'gemini-3.5-flash-lite');
  assert.equal(calls[0].body.generationConfig.thinkingConfig.thinkingLevel, 'low');
  assert.equal(calls[0].body.generationConfig.temperature, undefined);
}));

test('a missing model falls back once to a stable Gemini model', () => withEnv({ GEMINI_API_KEY: 'g', GEMINI_WRITE_MODEL: 'gemini-made-up' }, async () => {
  const urls = [];
  const fake = async (url) => { urls.push(url); return url.includes('made-up') ? { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) } : { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }) }; };
  assert.equal(await aiText({ user: 'Hi' }, { fetchImpl: fake }), 'ok');
  assert.equal(urls.length, 2);
  delete process.env.GEMINI_WRITE_MODEL;
}));

test('without a Gemini key, or with AI_PROVIDER=anthropic, calls go to Claude unchanged', async () => {
  for (const env of [{ GEMINI_API_KEY: undefined }, { GEMINI_API_KEY: 'g', AI_PROVIDER: 'anthropic' }]) {
    await withEnv(env, async () => {
      const urls = [];
      await routeAi(async (url) => { urls.push(url); return { ok: true, json: async () => ({}) }; })('https://api.anthropic.com/v1/messages', { body: anthropicBody('claude-sonnet-4-6') });
      assert.equal(urls[0], 'https://api.anthropic.com/v1/messages');
    });
  }
});

test('requests with tools stay on Claude, and other URLs pass through', () => withEnv({ GEMINI_API_KEY: 'g' }, async () => {
  const urls = [];
  const fake = async (url) => { urls.push(url); return { ok: true, json: async () => ({}) }; };
  await routeAi(fake)('https://api.anthropic.com/v1/messages', { body: JSON.stringify({ model: 'x', tools: [{}], messages: [] }) });
  await routeAi(fake)('https://example.com/x', {});
  assert.deepEqual(urls, ['https://api.anthropic.com/v1/messages', 'https://example.com/x']);
}));

test('a retired model moves on to the next current one, and a rejected thinking setting is dropped', () => withEnv({ GEMINI_API_KEY: 'g' }, async () => {
  const seen = [];
  const fake = async (url, init) => {
    const body = JSON.parse(init.body); seen.push([url.match(/models\/([^:]+)/)[1], Boolean(body.generationConfig.thinkingConfig)]);
    if (url.includes('gemini-3.8-flash')) return { ok: false, status: 400, json: async () => ({ error: { message: 'This model models/gemini-3.8-flash is no longer available to new users.' } }) };
    if (body.generationConfig.thinkingConfig) return { ok: false, status: 400, json: async () => ({ error: { message: 'Invalid thinking config' } }) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'fine' }] } }] }) };
  };
  assert.equal(await aiText({ user: 'Hi' }, { fetchImpl: fake }), 'fine');
  assert.deepEqual(seen, [['gemini-3.8-flash', true], ['gemini-3.7-flash', true], ['gemini-3.7-flash', false]]);
}));
