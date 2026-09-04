import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { enforceGraphqlAsyncRegistrationContract } from './graphql-async-registration-contract.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

const localizedAsyncRegistrationSections = [
  ['packages/graphql/README.md', '## Public API', 'synchronous-only registration'],
  ['packages/graphql/README.ko.md', '## 공개 API', '동기 전용 등록'],
  ['docs/getting-started/migrate-from-nestjs.md', '## GraphQL async registration migration', 'synchronous-only registration'],
  ['docs/getting-started/migrate-from-nestjs.ko.md', '## GraphQL 비동기 등록 마이그레이션', '동기 전용 등록'],
  ['book/intermediate/ch18-graphql.md', '### Resolving Module Options Asynchronously', 'synchronous-only registration'],
  ['book/intermediate/ch18-graphql.ko.md', '### 비동기 Module Option 해석', '동기 전용 등록'],
  ['docs/reference/package-surface.md', '## GraphQL async module registration', 'synchronous-only registration'],
  ['docs/reference/package-surface.ko.md', '## GraphQL 비동기 module 등록', '동기 전용 등록'],
] as const;

const semanticSynchronousOnlyClaims = [
  [
    'book/intermediate/ch18-graphql.md',
    '### Resolving Module Options Asynchronously',
    'GraphqlModule only supports synchronous registration.',
  ],
  [
    'book/intermediate/ch18-graphql.ko.md',
    '### 비동기 Module Option 해석',
    'GraphqlModule은 동기 등록만 지원합니다.',
  ],
] as const;

const migrationTableContradictions = [
  [
    'docs/getting-started/migrate-from-nestjs.md',
    'Async registration supports only explicit `inject` tokens and `useFactory`;',
    '`GraphqlModule` supports synchronous registration only; `forRootAsync(...)` has no contract.',
  ],
  [
    'docs/getting-started/migrate-from-nestjs.ko.md',
    'Async registration은 명시적인 `inject` token과 `useFactory`만 지원합니다.',
    '`GraphqlModule`은 동기 등록만 지원하며 `forRootAsync(...)` 계약은 없습니다.',
  ],
] as const;

describe('GraphQL async registration contract', () => {
  it('keeps the injected async registration source and documentation contract synchronized', () => {
    expect(() => enforceGraphqlAsyncRegistrationContract()).not.toThrow();
  });

  it('rejects a registration provider that does not receive the runtime container', () => {
    const readWithoutRuntimeContainer = (relativePath: string): string =>
      relativePath === 'packages/graphql/src/module.ts'
        ? read(relativePath).replace('inject: [RUNTIME_CONTAINER],', 'inject: [],')
        : read(relativePath);

    expect(() => enforceGraphqlAsyncRegistrationContract(readWithoutRuntimeContainer)).toThrow(
      /runtime-container options provider/u,
    );
  });

  it('rejects documentation that no longer names the async registration entrypoint', () => {
    const readWithoutEntryPoint = (relativePath: string): string =>
      relativePath === 'docs/CONTEXT.md'
        ? read(relativePath).replace('GraphqlModule.forRootAsync', 'GraphqlModule.forRootDeferred')
        : read(relativePath);

    expect(() => enforceGraphqlAsyncRegistrationContract(readWithoutEntryPoint)).toThrow(
      'docs/CONTEXT.md',
    );
  });

  it.each(localizedAsyncRegistrationSections)(
    'rejects a contradictory async registration claim in %s',
    (documentationPath, sectionHeading, contradiction) => {
      const readWithContradictoryClaim = (relativePath: string): string =>
        relativePath === documentationPath
          ? read(relativePath).replace(
            sectionHeading,
            `${sectionHeading}\n\n${contradiction}`,
          )
          : read(relativePath);

      expect(() => enforceGraphqlAsyncRegistrationContract(readWithContradictoryClaim)).toThrow(
        /contradictory async registration claim/u,
      );
    },
  );

  it.each(semanticSynchronousOnlyClaims)(
    'rejects a semantic synchronous-only variant in %s',
    (documentationPath, sectionHeading, contradiction) => {
      const readWithSemanticContradiction = (relativePath: string): string =>
        relativePath === documentationPath
          ? read(relativePath).replace(sectionHeading, `${sectionHeading}\n\n${contradiction}`)
          : read(relativePath);

      expect(() => enforceGraphqlAsyncRegistrationContract(readWithSemanticContradiction)).toThrow(
        /contradictory async registration claim/u,
      );
    },
  );

  it.each(migrationTableContradictions)(
    'rejects a GraphQL migration-table contradiction in %s',
    (documentationPath, supportedClaim, contradiction) => {
      const readWithMigrationTableContradiction = (relativePath: string): string =>
        relativePath === documentationPath
          ? read(relativePath).replace(supportedClaim, contradiction)
          : read(relativePath);

      expect(() => enforceGraphqlAsyncRegistrationContract(readWithMigrationTableContradiction)).toThrow(
        /contradictory async registration claim/u,
      );
    },
  );
});
