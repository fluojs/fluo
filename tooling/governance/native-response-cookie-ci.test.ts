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

it('runs sharded PR suites with one worker to prevent shared artifact build races', () => {
  // Given
  const workflow = readFileSync(resolve(import.meta.dirname, '../../.github/workflows/node-verification.yml'), 'utf8');

  // When
  const testCommands = [...workflow.matchAll(/run: (pnpm vitest run .+)/gu)].map((match) => match[1]);

  // Then
  expect(testCommands).toHaveLength(4);
  for (const command of testCommands) {
    expect(command).toMatch(/--maxWorkers=1$/u);
  }
});

it('requires the Deno platform job before the Verify aggregate can pass', () => {
  // Given
  const workflow = readFileSync(resolve(import.meta.dirname, '../../.github/workflows/ci.yml'), 'utf8');

  // When
  const verifyJob = workflow.slice(workflow.indexOf('  verify:\n'));

  // Then
  expect(verifyJob).toMatch(/\n {6}- deno-platform\n/u);
});
