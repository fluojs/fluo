import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, it } from 'vitest';

it('builds the portable cookie helper dependency closure in native CI', () => {
  // Given
  const workflow = readFileSync(resolve(import.meta.dirname, '../../.github/workflows/ci.yml'), 'utf8');

  // When
  const nativeJob = workflow.slice(
    workflow.indexOf('  native-response-cookie-conformance:'),
    workflow.indexOf('  verify-platform-consistency-governance:'),
  );

  // Then
  expect(nativeJob).toContain('run: pnpm --filter @fluojs/http... build');
});

it('runs scoped PR package scripts serially to prevent shared artifact build races', () => {
  // Given
  const workflow = readFileSync(resolve(import.meta.dirname, '../../.github/workflows/ci.yml'), 'utf8');

  // When
  const scopedPackageTestStep = workflow.slice(
    workflow.indexOf('      - name: Test (scoped PR package scripts)'),
    workflow.indexOf('      - name: Test (scoped PR fallback paths)'),
  );

  // Then
  expect(scopedPackageTestStep).toMatch(
    /run: pnpm --workspace-concurrency=1 -r --if-present \$\{\{ needs\.resolve-pr-verification-scope\.outputs\.test_filter_args \}\} run test/u,
  );
});
