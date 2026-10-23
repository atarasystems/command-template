import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('Email Desk loads every active unsent draft without the generic 100-row cap', () => {
  const api = fs.readFileSync(new URL('../api/crm/email-drafts.js', import.meta.url), 'utf8');
  const ui = fs.readFileSync(new URL('../email-desk-organizer.js', import.meta.url), 'utf8');

  assert.match(api, /EMAIL_DESK_ACTIVE_STATUSES = \['draft','needs_review','needs_update','approved','ready_to_send'\]/);
  assert.match(api, /loadAllActiveEmailDeskDrafts/);
  assert.match(api, /\.range\(from, from \+ EMAIL_DESK_PAGE_SIZE - 1\)/);
  assert.match(api, /req\.query\.email_desk === '1'/);
  assert.match(ui, /api\('\?email_desk=1'\)/);
  assert.doesNotMatch(ui, /api\('\?limit=100'\)/);
});

test('Email Desk keeps completed history bounded while preserving the full unsent queue', () => {
  const api = fs.readFileSync(new URL('../api/crm/email-drafts.js', import.meta.url), 'utf8');
  assert.match(api, /EMAIL_DESK_HISTORY_STATUSES = \['sent','cancelled'\]/);
  assert.match(api, /EMAIL_DESK_HISTORY_LIMIT = 100/);
  assert.match(api, /return \[\.\.\.active, \.\.\.\(historyResult\.data \|\| \[\]\)\]/);
});
