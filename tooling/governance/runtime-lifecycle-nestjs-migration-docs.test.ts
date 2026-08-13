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
    [
      'packages/runtime/README.md',
      '`beforeApplicationShutdown()` is unsupported by default but remains available.',
    ],
    [
      'packages/runtime/README.ko.md',
      '`beforeApplicationShutdown()`은 기본적으로 지원되지 않지만 계속 사용할 수 있습니다.',
    ],
  ] as const)('rejects a negative-then-positive compatibility claim in %s', (relativePath, conflictingClaim) => {
    // Given
    const readWithConflictingClaim = (requestedPath: string): string =>
      requestedPath === relativePath ? `${read(requestedPath)}\n${conflictingClaim}` : read(requestedPath);

    // When
    const runGovernanceGuard = () => enforceRuntimeLifecycleNestjsMigrationDocs(readWithConflictingClaim);

    // Then
    expect(runGovernanceGuard).toThrow(/beforeApplicationShutdown/);
  });

  it.each([
    ['packages/runtime/README.md', 'fluo supports `beforeApplicationShutdown()` as a runtime lifecycle hook.'],
    ['docs/getting-started/migrate-from-nestjs.md', '`beforeApplicationShutdown()` is a supported hook in fluo.'],
    ['packages/runtime/README.ko.md', 'fluo는 `beforeApplicationShutdown()`을 runtime lifecycle hook으로 지원합니다.'],
    ['docs/getting-started/migrate-from-nestjs.ko.md', 'fluo가 지원하는 lifecycle hook은 `beforeApplicationShutdown()`입니다.'],
  ] as const)('rejects reordered positive compatibility claims in %s', (relativePath, contradiction) => {
    // Given
    const readWithContradiction = (requestedPath: string): string =>
      requestedPath === relativePath ? `${read(requestedPath)}\n${contradiction}` : read(requestedPath);

    // When
    const runGovernanceGuard = () => enforceRuntimeLifecycleNestjsMigrationDocs(readWithContradiction);

    // Then
    expect(runGovernanceGuard).toThrow(/beforeApplicationShutdown/);
  });

  it.each([
    ['packages/runtime/README.md', 'Do not claim that `beforeApplicationShutdown()` is supported.'],
    ['packages/runtime/README.ko.md', '`beforeApplicationShutdown()`이 지원됩니다라고 주장하지 마세요.'],
  ] as const)('accepts explicit negation in %s', (relativePath, negatedGuidance) => {
    // Given
    const readWithNegatedGuidance = (requestedPath: string): string =>
      requestedPath === relativePath ? `${read(requestedPath)}\n${negatedGuidance}` : read(requestedPath);

    // When
    const runGovernanceGuard = () => enforceRuntimeLifecycleNestjsMigrationDocs(readWithNegatedGuidance);

    // Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it.each([
    [
      'packages/runtime/README.md',
      'fluo supports `beforeApplicationShutdown()`, but does not recommend it.',
    ],
    [
      'packages/runtime/README.ko.md',
      'fluo는 `beforeApplicationShutdown()`을 지원하지만 사용을 권장하지 않습니다.',
    ],
  ] as const)('rejects positive support despite unrelated negation in %s', (relativePath, mixedClaim) => {
    // Given
    const readWithMixedClaim = (requestedPath: string): string =>
      requestedPath === relativePath ? `${read(requestedPath)}\n${mixedClaim}` : read(requestedPath);

    // When
    const runGovernanceGuard = () => enforceRuntimeLifecycleNestjsMigrationDocs(readWithMixedClaim);

    // Then
    expect(runGovernanceGuard).toThrow(/beforeApplicationShutdown/);
  });

  it.each([
    [
      'packages/runtime/src/types.ts',
      'export interface BeforeApplicationShutdown {\n  beforeApplicationShutdown(signal?: string): MaybePromise<void>;\n}',
    ],
    [
      'packages/runtime/src/bootstrap.ts',
      "function isBeforeApplicationShutdown(value: unknown): boolean {\n  return hasMethod(value, 'beforeApplicationShutdown');\n}",
    ],
  ] as const)('rejects beforeApplicationShutdown additions to %s', (relativePath, unsupportedHookSource) => {
    // Given
    const readWithUnsupportedRuntimeHook = (requestedPath: string): string =>
      requestedPath === relativePath ? `${read(requestedPath)}\n${unsupportedHookSource}` : read(requestedPath);

    // When
    const runGovernanceGuard = () => enforceRuntimeLifecycleNestjsMigrationDocs(readWithUnsupportedRuntimeHook);

    // Then
    expect(runGovernanceGuard).toThrow(/[Bb]eforeApplicationShutdown/);
  });

  it.each([
    [
      'packages/runtime/src/types.ts',
      'export interface OnApplicationDraining {\n  onApplicationDraining(signal?: string): MaybePromise<void>;\n}',
    ],
    [
      'packages/runtime/src/bootstrap.ts',
      "function isOnApplicationDraining(value: unknown): boolean {\n  return hasMethod(value, 'onApplicationDraining');\n}",
    ],
    [
      'packages/runtime/src/bootstrap.ts',
      'async function runApplicationDrainingHook(instance: { onApplicationDraining(): Promise<void> }) {\n  await instance.onApplicationDraining();\n}',
    ],
  ] as const)('rejects a fifth lifecycle hook added to %s', (relativePath, fifthHookSource) => {
    // Given
    const readWithFifthLifecycleHook = (requestedPath: string): string =>
      requestedPath === relativePath ? `${read(requestedPath)}\n${fifthHookSource}` : read(requestedPath);

    // When
    const runGovernanceGuard = () => enforceRuntimeLifecycleNestjsMigrationDocs(readWithFifthLifecycleHook);

    // Then
    expect(runGovernanceGuard).toThrow(/[Oo]nApplicationDraining/);
  });

  it('rejects a quoted lifecycle interface method', () => {
    // Given
    const readWithQuotedMethod = (requestedPath: string): string =>
      requestedPath === 'packages/runtime/src/types.ts'
        ? `${read(requestedPath)}\nexport interface BeforeApplicationShutdown {\n  'beforeApplicationShutdown'(): MaybePromise<void>;\n}`
        : read(requestedPath);

    // When
    const runGovernanceGuard = () => enforceRuntimeLifecycleNestjsMigrationDocs(readWithQuotedMethod);

    // Then
    expect(runGovernanceGuard).toThrow(/beforeApplicationShutdown/);
  });

  it('rejects a computed lifecycle interface method', () => {
    // Given
    const readWithComputedMethod = (requestedPath: string): string =>
      requestedPath === 'packages/runtime/src/types.ts'
        ? `${read(requestedPath)}\nexport interface BeforeApplicationShutdown {\n  ['beforeApplicationShutdown'](): MaybePromise<void>;\n}`
        : read(requestedPath);

    // When
    const runGovernanceGuard = () => enforceRuntimeLifecycleNestjsMigrationDocs(readWithComputedMethod);

    // Then
    expect(runGovernanceGuard).toThrow(/beforeApplicationShutdown/);
  });

  it.each([
    ['  | { beforeApplicationShutdown(): MaybePromise<void> };', /beforeApplicationShutdown/],
    ['  | string;', /unrecognized/],
  ] as const)('rejects an unrecognized LifecycleHooks union member %s', (unionMember, expectedError) => {
    // Given
    const readWithUnionMember = (requestedPath: string): string =>
      requestedPath === 'packages/runtime/src/types.ts'
        ? read(requestedPath).replace('  | OnApplicationShutdown;', `  | OnApplicationShutdown\n${unionMember}`)
        : read(requestedPath);

    // When
    const runGovernanceGuard = () => enforceRuntimeLifecycleNestjsMigrationDocs(readWithUnionMember);

    // Then
    expect(runGovernanceGuard).toThrow(expectedError);
  });

  it.each([
    [
      'template-literal probe',
      'function isBeforeApplicationShutdown(value: unknown): boolean {\n  return hasMethod(value, `beforeApplicationShutdown`);\n}',
    ],
    [
      'element-access invocation',
      "async function runBeforeApplicationShutdown(instance: Record<string, () => Promise<void>>) {\n  await instance['beforeApplicationShutdown']();\n}",
    ],
    [
      'parenthesized receiver invocation',
      'async function runBeforeApplicationShutdown(instance: { beforeApplicationShutdown(): Promise<void> }) {\n  await (instance).beforeApplicationShutdown();\n}',
    ],
    [
      'asserted receiver invocation',
      'async function runBeforeApplicationShutdown(instance: unknown) {\n  await (instance as { beforeApplicationShutdown(): Promise<void> }).beforeApplicationShutdown();\n}',
    ],
  ] as const)('rejects a lifecycle bootstrap %s', (_caseName, bypassSource) => {
    // Given
    const readWithBypass = (requestedPath: string): string =>
      requestedPath === 'packages/runtime/src/bootstrap.ts' ? `${read(requestedPath)}\n${bypassSource}` : read(requestedPath);

    // When
    const runGovernanceGuard = () => enforceRuntimeLifecycleNestjsMigrationDocs(readWithBypass);

    // Then
    expect(runGovernanceGuard).toThrow(/beforeApplicationShutdown/);
  });
});
