import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_SETTINGS, SECTIONS } from '../api/_lib/founder-settings.js';

const html = fs.readFileSync(new URL('../setup.html', import.meta.url), 'utf8');

function setupSections() {
  const src = html.match(/var SECTIONS = (\[[\s\S]*?\n  \]);/)[1];
  return vm.runInNewContext(src);
}

test('every setup question saves to a field Command reads', () => {
  const sections = setupSections();
  for (const s of sections) {
    assert.ok(SECTIONS.includes(s.key), `unknown section ${s.key}`);
    for (const q of s.qs) assert.ok(Object.hasOwn(DEFAULT_SETTINGS[s.key], q.k), `${s.key}.${q.k} is not a setting`);
  }
  const asked = new Set(sections.map((s) => s.key));
  for (const key of ['founder', 'company', 'brands', 'audience', 'funding', 'schedule', 'voice', 'links']) assert.ok(asked.has(key), `${key} is never asked`);
});

test('setup creates tables first, asks one question at a time, and lists outside connections', () => {
  assert.match(html, /\/api\/setup\/database/);
  assert.match(html, /Create my tables/);
  assert.match(html, /\(state\.i \+ 1\) \+ ' of ' \+ s\.qs\.length/);
  for (const key of ['GEMINI_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_REFRESH_TOKEN', 'SERPER_API_KEY', 'RESEND_API_KEY']) assert.ok(html.includes(key), key);
  assert.doesNotMatch(html, /Solei|Atara|SpectrumThrive|—|–/);
});
