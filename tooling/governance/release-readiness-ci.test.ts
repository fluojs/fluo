import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, it } from 'vitest';

it('runs full same-commit release readiness before the stable lane gate and Changesets action', () => {
  // Given
  const workflow = readFileSync(resolve(import.meta.dirname, '../../.github/workflows/release.yml'), 'utf8');

  // When
  const readinessStep = workflow.indexOf('      - name: Verify release readiness');
  const stableLaneGate = workflow.indexOf('      - name: Verify changeset release lane');
  const changesetsAction = workflow.indexOf('      - name: Create Release Pull Request or Publish to npm');

  // Then
  expect(readinessStep).toBeGreaterThanOrEqual(0);
  expect(workflow.slice(readinessStep, stableLaneGate)).toContain('run: pnpm verify:release-readiness');
  expect(readinessStep).toBeLessThan(stableLaneGate);
  expect(stableLaneGate).toBeLessThan(changesetsAction);
});
