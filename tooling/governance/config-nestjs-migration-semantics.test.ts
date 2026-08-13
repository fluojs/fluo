import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceConfigNestjsMigrationDocs } from './config-nestjs-migration-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('NestJS config migration semantics', () => {
  it.each([
    [
      'packages/config/README.md',
      '`ConfigModule.forRoot(...)` is the only module registration API in `@fluojs/config`.',
      'must scope the synchronous-only registration claim to ConfigModule',
    ],
    [
      'packages/config/README.ko.md',
      '`ConfigModule.forRoot(...)`는 `@fluojs/config`의 유일한 module registration API입니다.',
      'must scope the synchronous-only registration claim to ConfigModule',
    ],
    [
      'packages/config/README.md',
      'The package provides `ConfigModule.forRootAsync(...)` for asynchronous registration.',
      'must not claim that ConfigModule provides forRootAsync',
    ],
    [
      'packages/config/README.ko.md',
      '이 패키지는 비동기 등록을 위한 `ConfigModule.forRootAsync(...)`를 제공합니다.',
      'must not claim that ConfigModule provides forRootAsync',
    ],
    [
      'packages/config/README.md',
      'Use an asynchronous Standard Schema for configuration validation.',
      'must not allow asynchronous Standard Schema validation',
    ],
    [
      'packages/config/README.ko.md',
      '설정 검증에는 비동기 Standard Schema를 사용합니다.',
      'must not allow asynchronous Standard Schema validation',
    ],
  ] as const)('rejects contradictory migration guidance in %s', (relativePath, contradiction, expectedError) => {
    // Given
    const readWithContradiction = (requestedPath: string): string =>
      requestedPath === relativePath ? `${read(requestedPath)}\n${contradiction}` : read(requestedPath);

    // When
    const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithContradiction);

    // Then
    expect(runGovernanceGuard).toThrow(expectedError);
  });

  it.each([
    ['packages/config/README.md', 'application-owned bootstrap boundary'],
    ['packages/config/README.ko.md', 'application-owned bootstrap boundary'],
  ] as const)('requires the bootstrap boundary guidance in %s', (relativePath, requiredMeaning) => {
    // Given
    const readWithoutBootstrapBoundary = (requestedPath: string): string =>
      requestedPath === relativePath ? read(requestedPath).replace(requiredMeaning, '') : read(requestedPath);

    // When
    const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithoutBootstrapBoundary);

    // Then
    expect(runGovernanceGuard).toThrow(/must require asynchronous sources at the application-owned bootstrap boundary/);
  });

  it.each([
    [
      'packages/config/README.md',
      'exposes only synchronous `forRoot(...)` registration',
      'supports `forRoot(...)` registration',
    ],
    [
      'packages/config/README.ko.md',
      '동기 `forRoot(...)` registration만 노출하며',
      '`forRoot(...)` registration을 노출하며',
    ],
  ] as const)('requires the ConfigModule-scoped synchronous boundary in %s', (relativePath, scopedClaim, weakenedClaim) => {
    // Given
    const readWithWeakenedScope = (requestedPath: string): string =>
      requestedPath === relativePath ? read(requestedPath).replace(scopedClaim, weakenedClaim) : read(requestedPath);

    // When
    const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithWeakenedScope);

    // Then
    expect(runGovernanceGuard).toThrow(/must state that ConfigModule exposes synchronous forRoot without forRootAsync/);
  });

  it.each([
    ['packages/config/README.md'],
    ['packages/config/README.ko.md'],
  ] as const)('preserves the ConfigReloadModule registration contract in %s', (relativePath) => {
    // Given
    const readWithoutReloadRegistration = (requestedPath: string): string =>
      requestedPath === relativePath ? read(requestedPath).replace('ConfigReloadModule.forRoot(...)', '') : read(requestedPath);

    // When
    const runGovernanceGuard = () => enforceConfigNestjsMigrationDocs(readWithoutReloadRegistration);

    // Then
    expect(runGovernanceGuard).toThrow(/ConfigReloadModule\.forRoot/);
  });
});
