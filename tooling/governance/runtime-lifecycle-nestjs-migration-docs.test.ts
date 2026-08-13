import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceRuntimeLifecycleNestjsMigrationDocs } from './runtime-lifecycle-nestjs-migration-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('NestJS runtime lifecycle migration documentation', () => {
  it('keeps the four-hook runtime contract and migration guidance synchronized', () => {
    // Given
    const runGovernanceGuard = () => enforceRuntimeLifecycleNestjsMigrationDocs();

    // When / Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it.each([
    [
      'packages/runtime/README.md',
      '`beforeApplicationShutdown()` is supported as a fluo runtime lifecycle hook.',
    ],
    [
      'docs/getting-started/migrate-from-nestjs.md',
      'Use the beforeApplicationShutdown compatibility shim during migration.',
    ],
    [
      'packages/runtime/README.ko.md',
      '`beforeApplicationShutdown()`은 fluo runtime lifecycle hook으로 지원됩니다.',
    ],
    [
      'docs/getting-started/migrate-from-nestjs.ko.md',
      '마이그레이션에서는 beforeApplicationShutdown compatibility shim을 사용하세요.',
    ],
  ] as const)('rejects contradictory compatibility guidance in %s', (relativePath, contradiction) => {
    // Given
    const readWithContradiction = (requestedPath: string): string =>
      requestedPath === relativePath ? `${read(requestedPath)}\n${contradiction}` : read(requestedPath);

    // When
    const runGovernanceGuard = () => enforceRuntimeLifecycleNestjsMigrationDocs(readWithContradiction);

    // Then
    expect(runGovernanceGuard).toThrow(/beforeApplicationShutdown/);
  });

  it.each([
    ['packages/runtime/src/types.ts'],
    ['packages/runtime/src/bootstrap.ts'],
  ] as const)('rejects beforeApplicationShutdown additions to %s', (relativePath) => {
    // Given
    const readWithUnsupportedRuntimeHook = (requestedPath: string): string =>
      requestedPath === relativePath ? `${read(requestedPath)}\nbeforeApplicationShutdown` : read(requestedPath);

    // When
    const runGovernanceGuard = () => enforceRuntimeLifecycleNestjsMigrationDocs(readWithUnsupportedRuntimeHook);

    // Then
    expect(runGovernanceGuard).toThrow(/must not add beforeApplicationShutdown/);
  });
});
