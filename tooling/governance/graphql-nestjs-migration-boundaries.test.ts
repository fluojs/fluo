import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { enforceGraphqlNestjsMigrationBoundaries } from './graphql-nestjs-migration-boundaries.mjs';

const repoRoot = join(import.meta.dirname, '..', '..');
const migrationMarker =
  '<!-- fluo:graphql-nestjs-migration: principal=before-graphql; connection-params=untrusted-record; endpoint=fixed-/graphql; nest-path-option=unsupported; root-signature=input-context; decorator-targets=public-instance; private-static-targets=rejected; output-nullability=explicit; arg-nullability=nullable; resolver-scope=request; operation-disposal=completion-or-disconnect; async-iterable-cleanup=application-owned; field-resolver=code-first; schema-first-field-resolver=unsupported; nest-dynamic-module=unsupported; parameter-decorators=unsupported -->';
const resolverMigrationFacts = [
  ['field-argument-dto', 'code-first-input-args-arg-types'],
  ['schema-first-field-resolver', 'unsupported'],
  ['async-registration', 'inject-use-factory'],
  ['nest-dynamic-options', 'unsupported'],
  ['subscription-topics', 'unsupported'],
] as const;
const governedDocumentationPaths = [
  'docs/getting-started/migrate-from-nestjs.md',
  'docs/getting-started/migrate-from-nestjs.ko.md',
  'packages/graphql/README.md',
  'packages/graphql/README.ko.md',
  'book/intermediate/ch18-graphql.md',
  'book/intermediate/ch18-graphql.ko.md',
] as const;
const canonicalMigrationLinks = [
  ['docs/CONTEXT.md', './getting-started/migrate-from-nestjs.md#graphql-migration-boundaries'],
  ['docs/CONTEXT.ko.md', './getting-started/migrate-from-nestjs.ko.md#graphql-마이그레이션-경계'],
  ['packages/graphql/README.md', '../../docs/getting-started/migrate-from-nestjs.md#graphql-migration-boundaries'],
  ['packages/graphql/README.ko.md', '../../docs/getting-started/migrate-from-nestjs.ko.md#graphql-마이그레이션-경계'],
] as const;

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function replaceResolverMigrationMarker(
  document: string,
  transform: (resolverMigrationMarker: string) => string,
): string {
  const resolverMigrationMarker = document.match(
    /<!-- fluo:graphql-resolver-migration: [\s\S]*? -->/u,
  )?.[0];
  if (resolverMigrationMarker === undefined) {
    throw new Error('Expected a resolver migration sentinel.');
  }

  const changedMarker = transform(resolverMigrationMarker);
  expect(changedMarker).not.toBe(resolverMigrationMarker);

  const changedDocument = document.replace(resolverMigrationMarker, changedMarker);
  expect(changedDocument).not.toBe(document);
  return changedDocument;
}

function rewordResolverMigrationHeading(document: string): string {
  const resolverMigrationMarkerIndex = document.indexOf('<!-- fluo:graphql-resolver-migration: ');
  if (resolverMigrationMarkerIndex === -1) {
    throw new Error('Expected a resolver migration sentinel.');
  }

  const headingStart = document.lastIndexOf('\n### ', resolverMigrationMarkerIndex);
  if (headingStart === -1) {
    throw new Error('Expected a resolver migration subsection heading.');
  }

  const headingEnd = document.indexOf('\n', headingStart + 1);
  const changedDocument = [
    document.slice(0, headingStart),
    '\n### Reworded resolver migration boundary',
    document.slice(headingEnd),
  ].join('');
  expect(changedDocument).not.toBe(document);
  return changedDocument;
}

describe('GraphQL NestJS migration boundaries', () => {
  it('keeps the complete structural migration contract enforced', () => {
    expect(() => enforceGraphqlNestjsMigrationBoundaries()).not.toThrow();
  });

  it.each(governedDocumentationPaths)(
    'rejects a missing structural fact in %s',
    (driftedPath) => {
      const readWithoutPrincipalFact = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace('principal=before-graphql', 'principal=missing')
          : read(relativePath);

      expect(() => enforceGraphqlNestjsMigrationBoundaries(readWithoutPrincipalFact)).toThrow(driftedPath);
    },
  );

  it('rejects a missing migration sentinel', () => {
    const readWithoutMarker = (relativePath: string): string =>
      relativePath === governedDocumentationPaths[0]
        ? read(relativePath).replace(migrationMarker, '')
        : read(relativePath);

    expect(() => enforceGraphqlNestjsMigrationBoundaries(readWithoutMarker)).toThrow(
      governedDocumentationPaths[0],
    );
  });

  it('rejects duplicate migration sentinels', () => {
    const readWithDuplicateMarker = (relativePath: string): string =>
      relativePath === governedDocumentationPaths[0]
        ? read(relativePath).replace(migrationMarker, `${migrationMarker}\n${migrationMarker}`)
        : read(relativePath);

    expect(() => enforceGraphqlNestjsMigrationBoundaries(readWithDuplicateMarker)).toThrow(
      governedDocumentationPaths[0],
    );
  });

  it.each(governedDocumentationPaths.slice(0, 2))(
    'rejects each changed legacy resolver migration fact in %s',
    (driftedPath) => {
      for (const [name, value] of resolverMigrationFacts) {
        const readWithDriftedResolverFact = (relativePath: string): string =>
          relativePath === driftedPath
            ? replaceResolverMigrationMarker(read(relativePath), (resolverMigrationMarker) =>
              resolverMigrationMarker.replace(`${name}=${value}`, `${name}=regressed`),
            )
            : read(relativePath);

        expect(() => enforceGraphqlNestjsMigrationBoundaries(readWithDriftedResolverFact)).toThrow(
          driftedPath,
        );
      }
    },
  );

  it.each(governedDocumentationPaths.slice(0, 2))(
    'accepts a reworded resolver subsection heading in %s',
    (driftedPath) => {
      const readWithRewordedResolverHeading = (relativePath: string): string =>
        relativePath === driftedPath
          ? rewordResolverMigrationHeading(read(relativePath))
          : read(relativePath);

      expect(() => enforceGraphqlNestjsMigrationBoundaries(readWithRewordedResolverHeading)).not.toThrow();
    },
  );

  it('rejects a missing legacy resolver migration sentinel', () => {
    const readWithoutResolverMigrationMarker = (relativePath: string): string =>
      relativePath === governedDocumentationPaths[0]
        ? replaceResolverMigrationMarker(read(relativePath), () => '')
        : read(relativePath);

    expect(() => enforceGraphqlNestjsMigrationBoundaries(readWithoutResolverMigrationMarker)).toThrow(
      governedDocumentationPaths[0],
    );
  });

  it.each(canonicalMigrationLinks)(
    'accepts a changed link label when the canonical destination remains in %s',
    (driftedPath, destination) => {
      const readWithRewordedLabel = (relativePath: string): string => {
        const original = read(relativePath);
        if (relativePath !== driftedPath) {
          return original;
        }

        const reworded = original.replace(
          new RegExp(`\\[[^\\]\\n]+\\]\\(${destination.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\)`, 'u'),
          `[Reworded link label](${destination})`,
        );
        expect(reworded).not.toBe(original);
        return reworded;
      };

      expect(() => enforceGraphqlNestjsMigrationBoundaries(readWithRewordedLabel)).not.toThrow();
    },
  );

  it.each(canonicalMigrationLinks)(
    'rejects a changed canonical link destination in %s',
    (driftedPath, destination) => {
      const readWithDriftedDestination = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace(`](${destination})`, '](./getting-started/migration-drift)')
          : read(relativePath);

      expect(() => enforceGraphqlNestjsMigrationBoundaries(readWithDriftedDestination)).toThrow(
        driftedPath,
      );
    },
  );
});
