import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=(path)=>fs.readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('application uploads stay in the private personal-docs bucket',()=>{
  const source=read('api/applications/upload.js');
  assert.match(source,/const BUCKET = 'personal-docs'/);
  assert.match(source,/withCommandAuth/);
  assert.match(source,/MAX_BYTES = 3_500_000/);
  assert.doesNotMatch(source,/public-assets/);
});

test('application downloads use short-lived signed URLs',()=>{
  const source=read('api/applications/download.js');
  assert.match(source,/createSignedUrl/);
  assert.match(source,/300/);
  assert.match(source,/withCommandAuth/);
});

test('deleting an uploaded document also removes its private object',()=>{
  const source=read('api/applications/documents.js');
  assert.match(source,/storage_bucket/);
  assert.match(source,/storage_path/);
  assert.match(source,/\.remove\(\[existing\.data\.storage_path\]\)/);
});

test('Funding Vault replacement creates immutable versions without deleting old objects',()=>{
  const migration=read('supabase/schema/command-schema.sql');
  const upload=read('api/applications/upload.js');
  assert.match(migration,/command_funding_document_versions/);
  assert.match(migration,/supersedes_version_id/);
  assert.match(upload,/funding-vault/);
  assert.match(upload,/status:'superseded'/);
  assert.match(upload,/storage\.from\(BUCKET\)\.upload/);
});

test('Funding Vault upload validation distinguishes application and master uploads',()=>{
  const upload=read('api/applications/upload.js');
  assert.match(upload,/MISSING_DOCUMENT_KEY/);
  assert.match(upload,/MISSING_FILE/);
  assert.match(upload,/UNSUPPORTED_FILE_TYPE/);
  assert.match(upload,/FILE_TOO_LARGE/);
  assert.match(upload,/extensionMime/);
  assert.match(upload,/resolvedMime/);
});
