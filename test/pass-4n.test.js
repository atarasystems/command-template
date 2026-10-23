import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('Pass 4N exposes Morning Brief in the existing unified Navigate menu', () => {
  assert.match(html, /command-nav-group-title">Today[\s\S]*mobileNavGo\('panel-morning-brief'\)[\s\S]*Morning Brief/);
  assert.match(html, /id="panel-morning-brief"/);
  assert.doesNotMatch(html, /id="panel-morning-brief-2"/);
});

test('Pass 4N makes Prepare Communication the canonical reviewable outreach path', () => {
  assert.match(html, /Prepare Communication<\/strong> is the canonical path/);
  assert.match(html, /Draft saved in Email Desk for founder review/);
  assert.match(html, /Open in Email Desk/);
  assert.match(html, /id="panel-email-desk"/);
  assert.equal((html.match(/id="panel-email-desk"/g) || []).length, 1);
  assert.doesNotMatch(html, /submitCommunicationPreparation[\s\S]{0,500}send-email/);
});

test('Pass 4N documents the existing Work, Knowledge, CRM, and communication boundaries', () => {
  for (const phrase of [
    'Work is the execution record',
    'Knowledge is the source for instructions and SOPs',
    'The Prompt Library holds reusable preparation',
    'completed communication history lives in CRM activities',
    'Operator loop:',
    'Weekly check:',
    'escalate sensitive or consequential decisions to the founder',
  ]) assert.match(html, new RegExp(phrase.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
});

test('Pass 4N clarifies opportunity and audience roles without new systems', () => {
  for (const phrase of [
    'Revenue, partnerships, consulting, and strategic business opportunities.',
    'deeper commercial pipeline and record management',
    'This surface manages consent only',
  ]) assert.match(html, new RegExp(phrase.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')));
  assert.doesNotMatch(html, /CREATE TABLE|crm_operator|operator_approval|sop_id/i);
});

test('Pass 4N preserves intentional non-handoffs and protected workflow boundaries', () => {
  assert.match(html, /mobileNavGo\('panel-intelligence'\)/);
  assert.match(html, /function refreshIntelligence\(\)/);
  assert.doesNotMatch(html, /scout-review|openScoutCandidates|atarasystems\.com/);
});
