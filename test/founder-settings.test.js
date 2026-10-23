import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import {
  DEFAULT_SETTINGS, envTimeZone, founderSettings, knowledgeText, settingsFromRows, setupStatus, voiceText, clearSettingsCache, fundingProfileText,
} from '../api/_lib/founder-settings.js';
import { validateSection, draftVoice } from '../api/settings/index.js';
import { createTables, databaseUrl } from '../api/setup/database.js';
import { SAMPLE, SAMPLE_ROWS } from './fixtures/founder.js';

const PERSONAL = /Solei|Atara|SpectrumThrive|SCOPE|Sky Harper|Maryland|TEDCO|soleiwilliams/;

test('empty settings fall back to safe defaults with nothing personal in them', () => {
  const s = settingsFromRows([]);
  assert.deepEqual(s.completed, []);
  assert.equal(s.modules.money, false, 'Money starts hidden');
  assert.doesNotMatch(knowledgeText(s), PERSONAL);
  assert.doesNotMatch(JSON.stringify(DEFAULT_SETTINGS), PERSONAL);
  assert.ok(setupStatus(s).every((x) => x.done === false));
});

test('the knowledge picture is built only from setup answers', () => {
  const k = knowledgeText(SAMPLE);
  for (const part of ['Maya Rivers', 'Northwind Studio', 'Northwind Orders', 'Bake Better', 'cal.example/maya', 'coffee chat']) assert.ok(k.includes(part), part);
  assert.match(voiceText(SAMPLE), /No em dashes/);
  assert.match(voiceText(SAMPLE), /5th grade/);
  assert.match(voiceText(SAMPLE), /synergy/);
  assert.doesNotMatch(voiceText({ ...SAMPLE, voice: { rules: 'Short.' } }), /dashes/);
  assert.match(fundingProfileText(SAMPLE), /women, veterans/);
  assert.deepEqual(setupStatus(SAMPLE).filter((x) => x.done).map((x) => x.section), ['founder', 'company', 'brands', 'funding', 'voice', 'links']);
});

test('loading settings sets the time zone for plain date math', async () => {
  clearSettingsCache();
  const db = { from: () => ({ select: async () => ({ data: [...SAMPLE_ROWS, { section: 'schedule', value: { time_zone: 'America/Chicago' } }], error: null }) }) };
  await founderSettings(db);
  assert.equal(envTimeZone(), 'America/Chicago');
  clearSettingsCache();
  const broken = { from: () => ({ select: async () => ({ data: null, error: { message: 'relation does not exist' } }) }) };
  const s = await founderSettings(broken);
  assert.equal(s.founder.name, '', 'a missing table still returns defaults');
});

test('setup answers are checked before saving', () => {
  assert.throws(() => validateSection('schedule', { time_zone: 'Mars/Base' }), /time zone/);
  assert.throws(() => validateSection('links', { booking_url: 'javascript:alert(1)' }), /https/);
  assert.throws(() => validateSection('nope', {}), /Unknown/);
  assert.throws(() => validateSection('founder', { email: 'maya@' }), /email/);
  const brands = validateSection('brands', { list: [{ name: 'Bake Better!', code: 'bb-1' }, { name: '' }] });
  assert.deepEqual(brands.list, [{ name: 'Bake Better!', code: 'BB1' }]);
  assert.equal(validateSection('company', { name: 'x'.repeat(9000) }).name.length, 4000);
});

test('pasted writing becomes voice rules without copying the content', async () => {
  await assert.rejects(draftVoice('too short'), /a little more/);
  let prompt;
  const out = await draftVoice('Hi team. '.repeat(40), { ai: async (args) => { prompt = args.prompt; return { rules: 'Short sentences.\nWarm.', uses_long_dashes: false, reading_level: '6th grade' }; } });
  assert.equal(out.rules, 'Short sentences.\nWarm.');
  assert.match(prompt, /Do not copy their content/);
});

test('first run reports a missing database connection in plain words', async () => {
  assert.equal(databaseUrl({ POSTGRES_URL_NON_POOLING: 'a', POSTGRES_URL: 'b' }), 'a');
  await assert.rejects(createTables({ url: '' }), /Connect Supabase/);
  const ran = [];
  class FakeClient { constructor(o) { this.o = o; } async connect() {} async query(q) { ran.push(q); } async end() {} }
  await createTables({ url: 'postgres://x@db.example/postgres', sql: 'select 1', Client: FakeClient });
  assert.deepEqual(ran, ['select 1', "notify pgrst, 'reload schema'"]);
});

test('the starting schema builds on an empty database, twice, with nothing personal in it', async () => {
  const sql = fs.readFileSync(new URL('../supabase/schema/command-schema.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql, PERSONAL);
  const db = new PGlite();
  await db.exec('create schema storage; create table storage.buckets (id text primary key, name text, public boolean);');
  await db.exec(sql);
  await db.exec(sql);
  await db.exec(`insert into command_settings (section, value) values ('schedule', '{"time_zone":"America/Chicago"}')`);
  assert.equal((await db.query('select command_time_zone() as tz')).rows[0].tz, 'America/Chicago');
  await db.exec(`insert into work_items (title) values ('First task')`);
  assert.equal((await db.query('select owner_type from work_items')).rows[0].owner_type, 'founder');
  await db.exec(`insert into command_updates (body, brand) values ('Shipped it', 'NW')`);
  await db.exec(`insert into command_linkedin_posts (post_date, topic) values ('2026-11-02', 'nw')`);
  const opp = await db.query(`select crm_create_opportunity('{"business_name":"Acme","email":"a@acme.test"}'::jsonb) as j`);
  assert.equal(opp.rows[0].j.opportunity.stage, 'new');
  assert.equal((await db.query(`select status from command_funding_kit where key = 'sam_gov'`)).rows[0].status, 'not_started');
  await db.close();
});
