import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyAttempt, parseBounds } from './github-actions-census.mjs';

test('preserves a hidden failed job from a later successful retry', () => {
  const result = classifyAttempt({
    conclusion: 'success',
    jobs: [{ conclusion: 'failure', completed_at: '2026-09-14T00:00:01Z', html_url: 'https://example.test/job', id: 1, name: 'test' }],
    run_attempt: 2,
  });
  assert.equal(result.kind, 'failure-bearing');
  assert.equal(result.failedJobs.length, 1);
});

test('separates zero-job approval expiry from job failure', () => {
  assert.equal(classifyAttempt({ conclusion: 'action_required', jobs: [], run_attempt: 1 }).kind, 'zero-job-action-required');
});

test('accepts strict half-open UTC bounds', () => {
  assert.deepEqual(parseBounds('2026-09-14T00:00:00Z', '2026-09-15T00:00:00Z'), {
    since: '2026-09-14T00:00:00.000Z',
    until: '2026-09-15T00:00:00.000Z',
  });
  assert.throws(() => parseBounds('bad', '2026-09-15T00:00:00Z'), /UTC/u);
});
