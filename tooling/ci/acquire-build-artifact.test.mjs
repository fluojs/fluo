import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyAcquisitionFailure, validateArtifactMetadata } from './acquire-build-artifact.mjs';

test('retries only intermediary 403 and explicit acquisition 5xx statuses', () => {
  assert.equal(classifyAcquisitionFailure({ status: 403, text: 'upstream request timeout through intermediary' }).retry, true);
  assert.equal(classifyAcquisitionFailure({ status: 503, text: 'service unavailable' }).retry, true);
  assert.equal(classifyAcquisitionFailure({ status: 403, text: 'forbidden' }).retry, false);
  assert.equal(classifyAcquisitionFailure({ status: 401, text: 'bad credentials' }).retry, false);
  assert.equal(classifyAcquisitionFailure({ status: 404, text: 'expired' }).retry, false);
});

test('rejects artifact identity or digest mismatch before restore', () => {
  const expected = { digest: 'a'.repeat(64), id: 1, name: 'node-build', runId: 2, sha: 'b'.repeat(40) };
  assert.equal(validateArtifactMetadata({ ...expected, workflow_run: { head_sha: expected.sha, id: 2 } }, expected), true);
  assert.throws(() => validateArtifactMetadata({ ...expected, digest: 'c'.repeat(64), workflow_run: { head_sha: expected.sha, id: 2 } }, expected), /digest/u);
});
