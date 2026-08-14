import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceJwtAsyncRegistrationContract } from './jwt-async-registration-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('JWT async registration contract', () => {
  it('keeps source-backed injected-factory guidance synchronized across both locales', () => {
    // Given
    const runGovernanceGuard = () => enforceJwtAsyncRegistrationContract();

    // When / Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it('rejects extra dynamic-module fields in the shared AsyncModuleOptions source contract', () => {
    // Given
    const readWithImports = (relativePath: string): string =>
      relativePath === 'packages/core/src/types.ts'
        ? read(relativePath).replace(
            'export interface AsyncModuleOptions<T> {',
            'export interface AsyncModuleOptions<T> {\n  imports?: Constructor[];',
          )
        : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceJwtAsyncRegistrationContract(readWithImports);

    // Then
    expect(runGovernanceGuard).toThrow(/limited to inject and useFactory/);
  });

  it('rejects JwtModule source that forwards a discovery-shaped field instead of inject', () => {
    // Given
    const readWithImports = (relativePath: string): string =>
      relativePath === 'packages/jwt/src/module.ts'
        ? read(relativePath).replace('inject: options.inject,', 'inject: options.imports,')
        : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceJwtAsyncRegistrationContract(readWithImports);

    // Then
    expect(runGovernanceGuard).toThrow(/read only inject\/useFactory/);
  });

  it.each([
    'packages/jwt/README.md',
    'packages/jwt/README.ko.md',
    'docs/getting-started/migrate-from-nestjs.md',
    'docs/getting-started/migrate-from-nestjs.ko.md',
    'book/beginner/ch14-jwt.md',
    'book/beginner/ch14-jwt.ko.md',
    'docs/CONTEXT.md',
    'docs/CONTEXT.ko.md',
  ] as const)('reports missing contract guidance in %s', (targetPath) => {
    // Given
    const readWithoutGuidance = (relativePath: string): string =>
      relativePath === targetPath ? '' : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceJwtAsyncRegistrationContract(readWithoutGuidance);

    // Then
    expect(runGovernanceGuard).toThrow(targetPath);
  });

  it.each([
    [
      'packages/jwt/README.md',
      '`JwtModule.forRootAsync(...)` accepts `imports`, `useClass`, and `useExisting` as valid options.',
      /must not claim that NestJS imports\/useClass\/useExisting fields are accepted/,
    ],
    [
      'packages/jwt/README.ko.md',
      '`JwtModule.forRootAsync(...)`는 `imports`, `useClass`, `useExisting` option을 지원합니다.',
      /must not claim that NestJS imports\/useClass\/useExisting fields are accepted/,
    ],
    [
      'docs/getting-started/migrate-from-nestjs.md',
      'Although `JwtModule.forRootAsync(...)` does not recommend NestJS fields, `useClass` is accepted but ignored.',
      /must not claim that NestJS imports\/useClass\/useExisting fields are accepted/,
    ],
    [
      'docs/getting-started/migrate-from-nestjs.ko.md',
      '`JwtModule.forRootAsync(...)`는 NestJS field를 권장하지 않지만 `useExisting`을 받아서 무시합니다.',
      /must not claim that NestJS imports\/useClass\/useExisting fields are accepted/,
    ],
    [
      'book/beginner/ch14-jwt.md',
      '`JwtModule.forRootAsync(...)` automatically discovers providers from imported modules.',
      /must not claim implicit module or provider discovery/,
    ],
    [
      'book/beginner/ch14-jwt.ko.md',
      '`JwtModule.forRootAsync(...)`는 imported module의 provider를 자동 탐색합니다.',
      /must not claim implicit module or provider discovery/,
    ],
  ] as const)('rejects a contradictory proposition added to %s', (targetPath, contradiction, expectedError) => {
    // Given
    const readWithContradiction = (relativePath: string): string =>
      relativePath === targetPath ? `${read(relativePath)}\n${contradiction}` : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceJwtAsyncRegistrationContract(readWithContradiction);

    // Then
    expect(runGovernanceGuard).toThrow(expectedError);
  });
});
