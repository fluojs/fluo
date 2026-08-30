import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertMachineConflictScope,
  hasResolvedHeadPasses,
} from './conflict-resolution-policy.mjs';

test('ordinary heads cannot inherit PASS without typed conflict evidence', () => {
  assert.equal(hasResolvedHeadPasses({ conflict_resolution: null }), false);
  assert.equal(
    hasResolvedHeadPasses({
      conflict_resolution: {
        semantic_impact: 'mechanical',
        axes: ['contract', 'code', 'verification'],
      },
    }),
    false,
  );
});

test('machine minimum axes cannot be omitted or overridden by a reviewer', () => {
  const machine = {
    upstream_overlap: true,
    mechanical_inheritance_eligible: false,
    classifier: { minimum_affected_axes: ['code', 'verification'] },
  };
  assert.throws(
    () => assertMachineConflictScope({
      semantic_impact: 'scoped', upstream_relevant: true, affected_axes: [],
    }, machine),
    /cannot omit or override/u,
  );
  assert.doesNotThrow(() => assertMachineConflictScope({
    semantic_impact: 'scoped',
    upstream_relevant: true,
    affected_axes: ['contract', 'code', 'verification'],
  }, machine));
  assert.throws(
    () => assertMachineConflictScope({
      semantic_impact: 'mechanical', upstream_relevant: false, affected_axes: [],
    }, machine),
    /cannot omit or override/u,
  );
});
