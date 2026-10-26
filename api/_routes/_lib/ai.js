// One AI switch for Command. Features are written against the Anthropic Messages shape.
// When a Gemini key is set (and AI_PROVIDER is not 'anthropic'), the same request goes to Gemini instead,
// and the reply comes back in the same shape, so no feature has to change.

const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';
// Current Gemini 3 models (October 2026). If Google retires one, the next in line is used.
const FAST_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
const WRITE_MODELS = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash'];
export const GEMINI_FAST_MODEL = () => process.env.GEMINI_FAST_MODEL || FAST_MODELS[0];
export const GEMINI_WRITE_MODEL = () => process.env.GEMINI_WRITE_MODEL || WRITE_MODELS[0];
export function modelsFor(fast) { const first = fast ? GEMINI_FAST_MODEL() : GEMINI_WRITE_MODEL(); return [first, ...(fast ? FAST_MODELS : WRITE_MODELS).filter((m) => m !== first)]; }

export function geminiKey() { return process.env.GEMINI_API_KEY || ''; }
export function aiProvider() { return process.env.AI_PROVIDER === 'anthropic' || !geminiKey() ? 'anthropic' : 'gemini'; }
// The key features check before calling AI. With Gemini connected, the Claude key is no longer needed.
export function aiKey() { return process.env.ANTHROPIC_API_KEY || (geminiKey() ? 'gemini' : ''); }
export function aiConfigured() { return Boolean(geminiKey() || process.env.ANTHROPIC_API_KEY); }

function blocksText(content) {
  if (typeof content === 'string') return content;
  return (content || []).map((block) => (block?.type === 'text' ? block.text : '')).join('\n');
}
function onlyText(body) {
  const messages = body?.messages || [];
  return !body?.tools && messages.every((m) => typeof m.content === 'string' || (m.content || []).every((b) => b?.type === 'text'));
}

// Anthropic model name to a Gemini model: quick sorting jobs go to Flash-Lite, writing goes to Flash.
export function geminiModelFor(anthropicModel = '') {
  return /haiku/i.test(anthropicModel) ? GEMINI_FAST_MODEL() : GEMINI_WRITE_MODEL();
}

export function toGeminiRequest(body, { thinking = true } = {}) {
  const fast = /haiku/i.test(body?.model || '');
  const system = Array.isArray(body?.system) ? blocksText(body.system) : String(body?.system || '');
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: (body?.messages || []).map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: blocksText(m.content) }] })),
    generationConfig: {
      // Thinking tokens count toward the limit, so leave room for them.
      maxOutputTokens: Number(body?.max_tokens || 2000) + 2048,
      // Gemini 3 uses a thinking level and its own default sampling, so temperature is left to Gemini.
      ...(thinking ? { thinkingConfig: { thinkingLevel: fast ? 'minimal' : 'low' } } : {}),
    },
  };
}

export function fromGeminiResponse(data, model) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p) => !p.thought).map((p) => p.text || '').join('');
  return {
    id: data?.responseId || 'gemini', type: 'message', role: 'assistant', model,
    content: [{ type: 'text', text }],
    stop_reason: data?.candidates?.[0]?.finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn',
    usage: { input_tokens: data?.usageMetadata?.promptTokenCount || 0, output_tokens: data?.usageMetadata?.candidatesTokenCount || 0 },
  };
}

function jsonResponse(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload, text: async () => JSON.stringify(payload) };
}

function retiredModel(status, message) { return status === 404 || /no longer available|not found|is not supported|deprecated|shut down/i.test(message || ''); }

async function callGemini(fetchImpl, body) {
  const fast = /haiku/i.test(body?.model || '');
  let thinking = true;
  let last = null;
  for (const model of modelsFor(fast)) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetchImpl(`${GEMINI_API}/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiKey() }, body: JSON.stringify(toGeminiRequest(body, { thinking })),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) return jsonResponse(200, fromGeminiResponse(data, model));
      const message = data?.error?.message || `Gemini returned ${response.status}`;
      last = { status: response.status, message };
      // A model that rejects the thinking setting gets one try without it.
      if (response.status === 400 && thinking && /thinking/i.test(message)) { thinking = false; continue; }
      break;
    }
    if (!retiredModel(last?.status, last?.message)) break;
  }
  return jsonResponse(last?.status || 502, { type: 'error', error: { type: 'gemini_error', message: last?.message || 'Gemini did not answer.' } });
}

// Wrap a fetch function. Anthropic Messages calls go to Gemini when Gemini is the provider; everything else passes through.
export function routeAi(fetchImpl = fetch) {
  return async function aiFetch(url, init = {}) {
    if (aiProvider() === 'gemini' && /api\.anthropic\.com\/v1\/messages/.test(String(url))) {
      let body = {};
      try { body = JSON.parse(init.body || '{}'); } catch { body = {}; }
      if (onlyText(body)) return callGemini(fetchImpl, body);
    }
    return fetchImpl(url, init);
  };
}

// Simple text helper for new code. tier: 'fast' for sorting, 'write' for writing.
export async function aiText({ system = '', user, tier = 'write', maxTokens = 1500, temperature }, { fetchImpl = fetch } = {}) {
  const model = tier === 'fast' ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6';
  const apiKey = aiKey();
  if (aiProvider() === 'anthropic' && !apiKey) throw Object.assign(new Error('The AI assistant is not connected.'), { status: 503 });
  const response = await routeAi(fetchImpl)('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }], ...(typeof temperature === 'number' ? { temperature } : {}) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `AI returned ${response.status}`);
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// JSON from the AI, with optional pictures (data URLs). Gemini first; OpenAI only when it is the one key present.
// Every founder copy needs just the Gemini key.
const DATA_URL = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i;
function parseJsonText(text) {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1));
}
export async function aiJson({ prompt, images = [], tier = 'write', temperature = 0.2, maxTokens = 2000 }, { fetchImpl = fetch } = {}) {
  const key = geminiKey();
  if (key) {
    const parts = images.map((img) => { const m = String(img).match(DATA_URL); return m ? { inlineData: { mimeType: m[1], data: m[2].replace(/\s+/g, '') } } : null; }).filter(Boolean);
    parts.push({ text: prompt });
    let last = null;
    for (const model of modelsFor(tier === 'fast')) {
      const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json', temperature, maxOutputTokens: maxTokens } }),
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 404) { last = payload; continue; }
      if (!response.ok) throw Object.assign(new Error(payload?.error?.message || 'The AI could not answer. Try again.'), { status: 502 });
      return parseJsonText((payload?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join(''));
    }
    throw Object.assign(new Error(last?.error?.message || 'No AI model is available right now.'), { status: 502 });
  }
  if (process.env.OPENAI_API_KEY) {
    const content = [{ type: 'input_text', text: `${prompt}\n\nReturn JSON only.` }, ...images.map((img) => ({ type: 'input_image', image_url: img, detail: 'high' }))];
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-4.1-mini', store: false, temperature, max_output_tokens: maxTokens, input: [{ role: 'user', content }], text: { format: { type: 'json_object' } } }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload?.error?.message || 'The AI could not answer. Try again.'), { status: 502 });
    const text = typeof payload?.output_text === 'string' ? payload.output_text : (payload?.output || []).flatMap((i) => i?.content || []).filter((i) => i?.type === 'output_text').map((i) => i.text || '').join('');
    return parseJsonText(text);
  }
  throw Object.assign(new Error('Add the Gemini key to Command first.'), { code: 'AI_NOT_CONFIGURED', status: 503 });
}
