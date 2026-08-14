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
    expect(runGovernanceGuard).toThrow(/exactly global, inject, and useFactory/);
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
    expect(runGovernanceGuard).toThrow(/must forward inject and useFactory/);
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

  it.each([
    [
      'packages/jwt/README.md',
      '`JwtModule.forRootAsync(...)` does not disable automatic provider discovery.',
      /must not claim implicit module or provider discovery/,
    ],
    [
      'packages/jwt/README.ko.md',
      '`JwtModule.forRootAsync(...)`는 자동 provider discovery를 비활성화하지 않습니다.',
      /must not claim implicit module or provider discovery/,
    ],
    [
      'docs/getting-started/migrate-from-nestjs.md',
      '`JwtModule.forRootAsync(...)` rejects `imports`; however, it supports `useClass`.',
      /must not claim that NestJS imports\/useClass\/useExisting fields are accepted/,
    ],
    [
      'docs/getting-started/migrate-from-nestjs.ko.md',
      '`JwtModule.forRootAsync(...)`는 `imports`를 거부하지만 `useClass`는 지원합니다.',
      /must not claim that NestJS imports\/useClass\/useExisting fields are accepted/,
    ],
  ] as const)('rejects a compound contradiction in %s', (targetPath, contradiction, expectedError) => {
    // Given
    const readWithContradiction = (relativePath: string): string =>
      relativePath === targetPath ? `${read(relativePath)}\n${contradiction}` : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceJwtAsyncRegistrationContract(readWithContradiction);

    // Then
    expect(runGovernanceGuard).toThrow(expectedError);
  });

  it.each([
    [
      'book/beginner/ch14-jwt.md',
      '`JwtModule.forRootAsync(...)` supports applications whose providers are registered before the factory resolves. Neither `imports` nor `useClass` nor `useExisting` is supported.',
    ],
    [
      'book/beginner/ch14-jwt.ko.md',
      '`JwtModule.forRootAsync(...)`는 factory가 resolve되기 전에 provider를 등록한 애플리케이션을 지원합니다. `imports`, `useClass`, `useExisting` 중 어느 것도 지원하지 않습니다.',
    ],
  ] as const)('accepts a supported external configuration and rejected options in %s', (targetPath, guidance) => {
    // Given
    const readWithGuidance = (relativePath: string): string =>
      relativePath === targetPath ? `${read(relativePath)}\n${guidance}` : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceJwtAsyncRegistrationContract(readWithGuidance);

    // Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it.each([
    [
      'packages/jwt/README.md',
      '`JwtModule.forRootAsync(...)` accepts `imports` because those fields are not unsupported.',
    ],
    [
      'packages/jwt/README.ko.md',
      '`JwtModule.forRootAsync(...)`의 `imports`는 지원하지 않는 것은 아닙니다.',
    ],
    [
      'docs/getting-started/migrate-from-nestjs.md',
      '`JwtModule.forRootAsync(...)`: neither `imports` nor `useClass` nor `useExisting` is unsupported.',
    ],
    [
      'docs/getting-started/migrate-from-nestjs.md',
      '`JwtModule.forRootAsync(...)` `imports` are supported.',
    ],
    [
      'docs/getting-started/migrate-from-nestjs.ko.md',
      '`JwtModule.forRootAsync(...)`의 `imports`, `useClass`, `useExisting` 중 어느 것도 지원하지 않는 것은 아닙니다.',
    ],
  ] as const)('rejects unsupported-field double negation in %s', (targetPath, contradiction) => {
    // Given
    const readWithContradiction = (relativePath: string): string =>
      relativePath === targetPath ? `${read(relativePath)}\n${contradiction}` : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceJwtAsyncRegistrationContract(readWithContradiction);

    // Then
    expect(runGovernanceGuard).toThrow(/must not claim that NestJS imports\/useClass\/useExisting fields are accepted/);
  });

  it.each([
    [
      'book/beginner/ch14-jwt.md',
      '`JwtModule.forRootAsync(...)` can inject a provider local only to its parent module providers.',
    ],
    [
      'book/beginner/ch14-jwt.ko.md',
      '`JwtModule.forRootAsync(...)`는 부모 module providers에만 local인 provider를 주입할 수 있습니다.',
      /must not claim parent-local providers are visible to the JWT options provider/,
    ],
    [
      'docs/getting-started/migrate-from-nestjs.md',
      '`JwtModule.forRootAsync(...)` allows an ordinary sibling or parent module export alone that is visible to the JWT options provider.',
      /must not claim ordinary sibling or parent module exports are visible to the JWT options provider/,
    ],
  ] as const)('rejects unavailable JWT option dependencies in %s', (targetPath, contradiction, expectedError = /must not claim parent-local providers are visible to the JWT options provider/) => {
    // Given
    const readWithContradiction = (relativePath: string): string =>
      relativePath === targetPath ? `${read(relativePath)}\n${contradiction}` : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceJwtAsyncRegistrationContract(readWithContradiction);

    // Then
    expect(runGovernanceGuard).toThrow(expectedError);
  });

  it.each([
    ['packages/jwt/README.md', '<!-- `JwtModule.forRootAsync(...)` supports `inject` and `useFactory`. -->'],
    ['packages/jwt/README.ko.md', '<!-- `JwtModule.forRootAsync(...)`는 `inject`와 `useFactory`를 지원합니다. -->'],
    ['docs/getting-started/migrate-from-nestjs.md', '```md\n`JwtModule.forRootAsync(...)` supports `inject` and `useFactory`.\n```'],
    ['docs/getting-started/migrate-from-nestjs.ko.md', '```md\n`JwtModule.forRootAsync(...)`는 `inject`와 `useFactory`를 지원합니다.\n```'],
  ] as const)('does not accept hidden guidance in %s', (targetPath, hiddenGuidance) => {
    // Given
    const readWithHiddenOnly = (relativePath: string): string =>
      relativePath === targetPath ? hiddenGuidance : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceJwtAsyncRegistrationContract(readWithHiddenOnly);

    // Then
    expect(runGovernanceGuard).toThrow(targetPath);
  });

  it.each([
    [
      'packages/jwt/README.md',
      '````md\n```md\n`JwtModule.forRootAsync({ inject, useFactory, global? })` registers dependencies in the application module graph before the factory resolves, and `useFactory` returns final `JwtVerifierOptions`. The top-level `global?` controls module visibility and is distinct from the final `JwtVerifierOptions` returned by `useFactory`. `imports`, `useClass`, and `useExisting` are not part of the supported typed configuration, and automatic provider discovery is unsupported. Register dependencies through a global module or a module that exports them; a provider local only to a parent module\'s providers is not visible.\n```\n````',
    ],
    [
      'packages/jwt/README.ko.md',
      '````md\n```md\n`JwtModule.forRootAsync({ inject, useFactory, global? })`는 factory가 resolve되기 전에 application module graph에 의존성을 등록하며 `useFactory`는 최종 `JwtVerifierOptions`를 반환합니다. 최상위 `global?`은 module 가시성을 제어하며 `useFactory`가 반환하는 최종 `JwtVerifierOptions`와는 별개입니다. `imports`, `useClass`, `useExisting`은 지원되는 typed configuration의 일부가 아니며 자동 provider discovery도 지원하지 않습니다. 의존성은 global module 또는 export하는 module로 등록해야 하며 parent module providers에만 local인 provider는 보이지 않습니다.\n```\n````',
    ],
    [
      'docs/getting-started/migrate-from-nestjs.md',
      '````md\n````typescript\n`JwtModule.forRootAsync({ inject, useFactory, global? })` registers dependencies in the application module graph before the factory resolves, and `useFactory` returns final `JwtVerifierOptions`. The top-level `global?` controls module visibility and is distinct from the final `JwtVerifierOptions` returned by `useFactory`. `imports`, `useClass`, and `useExisting` are not part of the supported typed configuration, and automatic provider discovery is unsupported. Register dependencies through a global module or a module that exports them; a provider local only to a parent module\'s providers is not visible.\n````',
    ],
  ] as const)('does not accept guidance hidden by a longer fenced block in %s', (targetPath, hiddenGuidance) => {
    // Given
    const readWithHiddenOnly = (relativePath: string): string =>
      relativePath === targetPath ? hiddenGuidance : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceJwtAsyncRegistrationContract(readWithHiddenOnly);

    // Then
    expect(runGovernanceGuard).toThrow(targetPath);
  });
});
