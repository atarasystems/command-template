import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFundingPriority } from '../api/_routes/_lib/funding-priority.js';

test('funding priority excludes unknown inputs and exposes completeness', () => {
  const result = calculateFundingPriority({ strategic_fit_score: 100, eligibility_confidence_score: 80 });
  assert.equal(result.score, 91);
  assert.equal(result.completeness_percent, 45);
  assert.equal(result.provisional, true);
  assert.match(result.missing.join(', '), /Funding\/program value/);
});

test('funding priority does not fabricate a score when every input is unknown', () => {
  const result = calculateFundingPriority({});
  assert.equal(result.score, null);
  assert.equal(result.label, 'Needs Review');
  assert.equal(result.completeness_percent, 0);
  assert.equal(result.confidence, 'low');
});

test('typical planning effort is not a scoring input', () => {
  const result = calculateFundingPriority({ effort_min_hours: 3, effort_max_hours: 5 });
  assert.equal(result.score, null);
  assert.equal(result.completeness_percent, 0);
});
