import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { enforceGraphqlNestjsMigrationBoundaries } from './graphql-nestjs-migration-boundaries.mjs';

const repoRoot = join(import.meta.dirname, '..', '..');
const englishMigrationPath = 'docs/getting-started/migrate-from-nestjs.md';
const koreanMigrationPath = 'docs/getting-started/migrate-from-nestjs.ko.md';
const migrationBoundaryRequirements = [
  [
    englishMigrationPath,
    '## GraphQL Migration Boundaries',
    [
      'NestJS resolver guards and `GqlExecutionContext` do not transfer to `@fluojs/graphql`.',
      '`GraphqlModule` mounts the GraphQL HTTP endpoint at the fixed `/graphql` path.',
      'All resolver decorators target public instance members:',
      'Root `outputType` is never inferred:',
      "Resolvers that inject request-scoped providers must themselves use `@Scope('request')`.",
      'the application must return a typed `AsyncIterable` and close application resources when GraphQL stops consuming it.',
    ],
  ],
  [
    koreanMigrationPath,
    '## GraphQL 마이그레이션 경계',
    [
      'NestJS resolver guard와 `GqlExecutionContext`는 `@fluojs/graphql`로 이전되지 않습니다.',
      '`GraphqlModule`은 GraphQL HTTP endpoint를 고정된 `/graphql` path에 mount합니다.',
      '모든 resolver decorator는 public instance member를 대상으로 합니다.',
      'Root `outputType`은 추론되지 않습니다.',
      "Request-scoped provider를 주입하는 resolver에는 반드시 `@Scope('request')`를 붙여야 합니다.",
      'Application은 typed `AsyncIterable`을 반환하고 GraphQL이 소비를 멈출 때 application resource를 닫아야 합니다.',
    ],
  ],
] as const;

const discoverabilityRequirements = [
  [
    'docs/CONTEXT.md',
    '[GraphQL Migration Boundaries](./getting-started/migrate-from-nestjs.md#graphql-migration-boundaries)',
  ],
  [
    'docs/CONTEXT.ko.md',
    '[GraphQL 마이그레이션 경계](./getting-started/migrate-from-nestjs.ko.md#graphql-마이그레이션-경계)',
  ],
  [
    'packages/graphql/README.md',
    '[NestJS → fluo Migration Map](../../docs/getting-started/migrate-from-nestjs.md#graphql-migration-boundaries)',
  ],
  [
    'packages/graphql/README.ko.md',
    '[NestJS → fluo Migration Map](../../docs/getting-started/migrate-from-nestjs.ko.md#graphql-마이그레이션-경계)',
  ],
] as const;

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('GraphQL NestJS migration boundaries', () => {
  it('keeps the canonical migration-boundary contract enforced', () => {
    expect(() => enforceGraphqlNestjsMigrationBoundaries()).not.toThrow();
  });

  it.each(migrationBoundaryRequirements)(
    'rejects a missing canonical claim in %s',
    (driftedPath, _heading, requirements) => {
      for (const requirement of requirements) {
        const readWithoutClaim = (relativePath: string): string =>
          relativePath === driftedPath
            ? read(relativePath).replace(requirement, '[removed GraphQL migration claim]')
            : read(relativePath);

        expect(() => enforceGraphqlNestjsMigrationBoundaries(readWithoutClaim)).toThrow(driftedPath);
      }
    },
  );

  it.each(discoverabilityRequirements)(
    'rejects a missing canonical migration link in %s',
    (driftedPath, link) => {
      const readWithoutLink = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace(link, '[removed GraphQL migration link]')
          : read(relativePath);

      expect(() => enforceGraphqlNestjsMigrationBoundaries(readWithoutLink)).toThrow(driftedPath);
    },
  );
});
