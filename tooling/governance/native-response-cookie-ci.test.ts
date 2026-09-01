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
