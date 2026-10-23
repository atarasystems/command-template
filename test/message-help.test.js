import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt, shapeResult, writeReplies } from '../api/ai/message-help.js';
import { SAMPLE } from './fixtures/founder.js';

test('the reply prompt carries what the founder entered in setup and their booking link', () => {
  const p = buildPrompt({ ask: 'say yes to a call', notes: 'Speaking at a bakery expo in November.', settings: SAMPLE });
  assert.match(p, /cal\.example\/maya/); assert.match(p, /coffee chat/);
  assert.match(p, /Northwind Orders/); assert.match(p, /Maya is replying/);
  assert.match(p, /say yes to a call/); assert.match(p, /bakery expo/);
  assert.doesNotMatch(p, /Solei|SpectrumThrive|SCOPE|Atara/);
});

test('the reply prompt works before setup is finished', () => {
  const p = buildPrompt({ text: 'Hi there' });
  assert.match(p, /the founder is replying/);
  assert.doesNotMatch(p, /Solei|SpectrumThrive|Atara/);
});

test('replies come back without long dashes', () => {
  const r = shapeResult({ who: 'Dana', they_said: 'Asked to connect', replies: [{ label: 'Warm', text: 'Hi Dana — great to meet you.' }] });
  assert.equal(r.replies[0].text, 'Hi Dana, great to meet you.');
});

test('a screenshot goes to Gemini as an image', async () => {
  process.env.GEMINI_API_KEY = 'k';
  let sent;
  const fetchImpl = async (url, init) => { sent = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"who":"Dana","they_said":"Hi","watch_for":"","replies":[{"label":"Short","text":"Thanks Dana!"}]}' }] } }] }) }; };
  const r = await writeReplies({ image: 'data:image/png;base64,iVBORw0KGgo=' }, { fetchImpl });
  assert.equal(sent.contents[0].parts[0].inlineData.mimeType, 'image/png');
  assert.equal(r.replies[0].text, 'Thanks Dana!');
});
