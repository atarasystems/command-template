import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { cardFromInput, setupCardsPrompt, shapeSetupCards, SETUP_SOURCE } from '../api/know/index.js';

test('a typed card needs a question and an answer and lands in a known deck', () => {
  assert.throws(() => cardFromInput({ prompt: 'Who do we serve?' }), /question and an answer/);
  const c = cardFromInput({ deck: 'odd', prompt: ' Who do we serve? ', answer: ' Small bakeries ' });
  assert.equal(c.deck, 'pitch');
  assert.equal(c.prompt, 'Who do we serve?');
  assert.equal(c.answer, 'Small bakeries');
});

test('cards from Setup use only Setup facts and are marked as such', () => {
  const p = setupCardsPrompt('Company: Example Co.');
  assert.match(p, /Use ONLY the facts below/);
  assert.match(p, /Never add a number/);
  const made = shapeSetupCards({ cards: [{ deck: 'pitch', prompt: 'What do we do?', answer: 'Bake bread' }, { deck: 'news', prompt: 'x', answer: 'y' }, { prompt: '' }] });
  assert.equal(made.length, 2);
  assert.ok(made.every((c) => c.source === SETUP_SOURCE));
  assert.equal(made[1].deck, 'pitch', 'news is never made from Setup');
});

test('Know it offers ways to add facts and news refreshes each morning', () => {
  const page = fs.readFileSync(new URL('../know.html', import.meta.url), 'utf8');
  assert.match(page, /Make cards from my Setup/);
  assert.match(page, /Add a card/);
  assert.match(page, /each morning/);
  const cron = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).crons.find((c) => c.path === '/api/cron/know-news');
  assert.equal(cron.schedule, '5 11 * * *');
});
