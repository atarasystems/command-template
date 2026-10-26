import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Applications Hub uses authenticated Command APIs', () => {
  for (const path of ['api/_routes/applications/index.js','api/_routes/applications/answers.js','api/_routes/applications/facts.js','api/_routes/applications/draft.js','api/_routes/applications/submit.js','api/_routes/applications/documents.js','api/_routes/applications/export.js']) {
    const source = read(path);
    assert.match(source, /withCommandAuth/);
  }
});

test('submitted answers are frozen instead of overwritten', () => {
  const answers = read('api/_routes/applications/answers.js');
  const submit = read('api/_routes/applications/submit.js');
  assert.match(answers, /SUBMITTED_ANSWER_LOCKED/);
  assert.match(submit, /submitted_answer_text:row\.answer_text/);
  assert.match(submit, /answer_status:'submitted'/);
});

test('AI drafting is preparation only and grounded in current facts', () => {
  const source = read('api/_routes/applications/draft.js');
  assert.match(source, /founder-review preparation only/i);
  assert.match(source, /current company facts/i);
  assert.match(source, /Never invent traction/i);
  assert.doesNotMatch(source, /send-email|gmail\/action/);
});

test('Funding Hub page exposes the decision-based funding workflow', () => {
  const html = read('applications.html');
  for (const phrase of ['Funding Hub','Options','Chosen to Apply','Submitted / Waiting','History','Choose to Apply','Draft with AI','Freeze Submitted','Word record','Current company facts','Reusable answer library']) {
    assert.match(html, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
});

test('Funding Hub uses progressive disclosure and a focused application workspace', () => {
  const html = read('applications.html');
  assert.match(html, /aria-expanded/);
  assert.match(html, /aria-controls/);
  assert.match(html, /accordion-section/);
  assert.match(html, /focus-mode/);
  assert.match(html, /Back to Funding Hub/);
  assert.match(html, /question-toggle/);
  assert.match(html, /let openQuestionId=null/);
});

test('Funding Hub primary navigation replaces the duplicate metrics/accordion presentation', () => {
  const html = read('applications.html');
  assert.match(html, /workflow-nav/);
  assert.match(html, /function openMainLane/);
  assert.match(html, /Chosen to Apply/);
  assert.match(html, /workflow-card/);
  assert.match(html, /\.metrics\{display:none\}/);
  assert.match(html, /const chosen=applications\.filter/);
  assert.match(html, /chosen\?1:0/);
});

test('Primary navigation counts come from the rendered lane collections', () => {
  const html = read('applications.html');
  assert.match(html, /const laneCollections=laneData\(\)/);
  assert.match(html, /laneCollections\.opts\.length/);
  assert.match(html, /laneCollections\.submitted\.length/);
  assert.match(html, /\.map\(String\)/);
  assert.match(html, /nav-count/);
});

test('Funding Vault has one generated header and hides its body until expanded', () => {
  const html = read('applications.html');
  assert.match(html, /vault-panel:not\(\.is-open\)>\.panel-body\{display:none\}/);
  assert.match(html, /Array\.from\(head\.children\)\.forEach\(child=>\{if\(child!==toggle\)child\.remove\(\)\}\)/);
  assert.match(html, /openVaultUpload\(\)/);
  assert.match(html, /Funding Document Vault.*current master/);
});

test('Vault current-version upload preserves an internal key for legacy records', () => {
  const html = read('applications.html');
  assert.match(html, /openVaultUpload\('\$\{esc\(v\.document_key\)\}'\)/);
  assert.match(html, /Choose a document name before uploading a current version/);
  assert.match(html, /data-pending/);
});

test('Existing master replacement keeps stored metadata out of the editable modal', () => {
  const html = read('applications.html');
  assert.match(html, /Replace Current Version/);
  assert.match(html, /vaultUploadState\.documentType/);
  assert.match(html, /Upload New Version/);
  assert.match(html, /makeDocumentKey/);
  assert.match(html, /Display name/);
});

test('Word export uses frozen submitted answer when available', () => {
  const source = read('api/_routes/applications/export.js');
  assert.match(source, /submitted_answer_text \|\| row\.answer_text/);
  assert.match(source, /application\/msword/);
});
