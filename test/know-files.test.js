import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import JSZip from 'jszip';
import { acceptable, officeText, cardsFromFiles, shapeFileCards, filesPrompt } from '../api/_lib/know-files.js';

test('accepts business files and explains anything else in plain words', () => {
  assert.equal(acceptable('Deck.pdf', 1000), '');
  assert.equal(acceptable('Summary.docx', 1000), '');
  assert.match(acceptable('Deck.key', 1000), /Save Deck\.key as a PDF/);
  assert.match(acceptable('Big.pdf', 20 * 1024 * 1024), /larger than 15 MB/);
});

test('reads the words in Word and PowerPoint files', async () => {
  const docx = new JSZip(); docx.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>We serve bakeries &amp; cafes</w:t></w:r></w:p><w:p><w:r><w:t>40 customers</w:t></w:r></w:p></w:body></w:document>');
  const text = await officeText(await docx.generateAsync({ type: 'nodebuffer' }), 'docx');
  assert.match(text, /We serve bakeries & cafes\n40 customers/);
  const pptx = new JSZip();
  pptx.file('ppt/slides/slide2.xml', '<p:sld><a:p><a:r><a:t>The ask</a:t></a:r></a:p></p:sld>');
  pptx.file('ppt/slides/slide1.xml', '<p:sld><a:p><a:r><a:t>Problem</a:t></a:r></a:p></p:sld>');
  const slides = await officeText(await pptx.generateAsync({ type: 'nodebuffer' }), 'pptx');
  assert.ok(slides.indexOf('Problem') < slides.indexOf('The ask'), 'slides stay in order');
});

test('PDFs go to the AI as files, cards keep the file name, and nothing is made up', async () => {
  let seen = null;
  const ai = async (args) => { seen = args; return { cards: [{ deck: 'statistics', prompt: 'How many customers?', answer: '40', file: 2 }, { deck: 'odd', prompt: 'Who do we serve?', answer: 'Bakeries', file: 1 }, { prompt: '' }] }; };
  const cards = await cardsFromFiles([{ name: 'Deck.pdf', buffer: Buffer.from('%PDF') }, { name: 'Notes.txt', buffer: Buffer.from('40 customers') }], { ai });
  assert.equal(seen.images.length, 1);
  assert.match(seen.images[0], /^data:application\/pdf;base64,/);
  assert.match(seen.prompt, /Use ONLY what the documents say/);
  assert.match(seen.prompt, /40 customers/);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].source, 'Notes.txt');
  assert.equal(cards[1].deck, 'pitch');
  assert.equal(shapeFileCards({}, ['a']).length, 0);
  assert.match(filesPrompt({ names: ['A.pdf'], texts: [] }), /1\. A\.pdf/);
});

test('Know it page offers file upload and the server removes files after reading', () => {
  const page = fs.readFileSync(new URL('../know.html', import.meta.url), 'utf8');
  assert.match(page, /Add my files/);
  assert.match(page, /then deletes the files/);
  const api = fs.readFileSync(new URL('../api/know/index.js', import.meta.url), 'utf8');
  assert.match(api, /finally \{\s*await db\.storage\.from\(BUCKET\)\.remove/);
  const schema = fs.readFileSync(new URL('../supabase/schema/command-schema.sql', import.meta.url), 'utf8');
  assert.match(schema, /'know-docs', 'know-docs', false/);
});
