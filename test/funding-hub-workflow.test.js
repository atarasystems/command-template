import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=(path)=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('Funding Watch records remain options until explicit choice',()=>{
  const programs=read('api/_routes/opportunities/programs.js');
  const applications=read('api/_routes/applications/index.js');
  assert.match(programs,/funding_intent !== 'chosen'/);
  assert.match(programs,/if \(opportunity\.funding_intent !== 'chosen'\) return null/);
  assert.match(applications,/action === 'choose_to_apply'/);
  assert.match(applications,/funding_intent: 'chosen'/);
  assert.match(programs,/Only Choose to Apply can set funding intent to chosen/);
});

test('application creation reuses an existing opportunity link and has no production unique index',()=>{
  const applications=read('api/_routes/applications/index.js');
  const migration=read('supabase/schema/command-schema.sql');
  assert.match(applications,/eq\('program_opportunity_id', opportunityId\)/);
  assert.match(applications,/if \(!application\)/);
  assert.doesNotMatch(migration,/command_applications_program_opportunity.*unique/i);
});

test('submitted application documents and answers remain protected',()=>{
  const documents=read('api/_routes/applications/documents.js');
  const answers=read('api/_routes/applications/answers.js');
  const submit=read('api/_routes/applications/submit.js');
  assert.match(documents,/SUBMITTED_DOCUMENT_LOCKED/);
  assert.match(answers,/SUBMITTED_ANSWER_LOCKED/);
  assert.match(submit,/association_type','submitted'/);
});
