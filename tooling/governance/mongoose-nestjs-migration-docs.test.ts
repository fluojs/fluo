import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceMongooseNestjsMigrationDocs } from './mongoose-nestjs-migration-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mongooseContractMarker =
  '<!-- fluo-mongoose-contract: application-owned-connection, ambient-session-merge, preserves-operation-options, strict-fail-open, explicit-target -->';
const governedDocumentationPaths = [
  'docs/getting-started/migrate-from-nestjs.md',
  'docs/getting-started/migrate-from-nestjs.ko.md',
  'docs/architecture/transactions.md',
  'docs/architecture/transactions.ko.md',
  'docs/CONTEXT.md',
  'docs/CONTEXT.ko.md',
  'packages/mongoose/README.md',
  'packages/mongoose/README.ko.md',
  'apps/docs/content/docs/guides/persistence.mdx',
  'apps/docs/content/docs/guides/persistence.ko.mdx',
  'book/intermediate/ch19-mongoose.md',
  'book/intermediate/ch19-mongoose.ko.md',
] as const;
const migrationExamplePaths = [
  'docs/getting-started/migrate-from-nestjs.md',
  'docs/getting-started/migrate-from-nestjs.ko.md',
] as const;
const explicitDiExamplePaths = [
  ...migrationExamplePaths,
  'packages/mongoose/README.md',
  'packages/mongoose/README.ko.md',
] as const;

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('NestJS Mongoose migration documentation', () => {
  it('keeps the Mongoose migration and transaction contracts synchronized', () => {
    // Given
    const runGovernanceGuard = () => enforceMongooseNestjsMigrationDocs();

    // When / Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it.each(governedDocumentationPaths)(
    'rejects a removed machine contract anchor in %s',
    (driftedPath) => {
      // Given
      const readWithoutContractAnchor = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace(mongooseContractMarker, '[removed Mongoose contract anchor]')
          : read(relativePath);

      // When
      const runGovernanceGuard = () => enforceMongooseNestjsMigrationDocs(readWithoutContractAnchor);

      // Then
      expect(runGovernanceGuard).toThrow(driftedPath);
      expect(runGovernanceGuard).toThrow('fluo-mongoose-contract');
    },
  );

  it.each(migrationExamplePaths)(
    'rejects a duplicated marker or heading decoy in %s',
    (driftedPath) => {
      // Given
      const readWithDuplicateMarker = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace(
              mongooseContractMarker,
              `${mongooseContractMarker}\n${mongooseContractMarker}`,
            )
          : read(relativePath);
      const readWithHeadingDecoy = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace(/^## (Mongoose .+)$/mu, '### $1')
          : read(relativePath);

      // When
      const runDuplicateMarkerGuard = () =>
        enforceMongooseNestjsMigrationDocs(readWithDuplicateMarker);
      const runHeadingDecoyGuard = () => enforceMongooseNestjsMigrationDocs(readWithHeadingDecoy);

      // Then
      expect(runDuplicateMarkerGuard).toThrow(driftedPath);
      expect(runHeadingDecoyGuard).toThrow(driftedPath);
    },
  );

  it.each(migrationExamplePaths)(
    'requires both ambient-session merge and option-preservation anchors in %s',
    (driftedPath) => {
      // Given
      const readWithoutAmbientSessionMerge = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace('ambient-session-merge', 'removed-session-merge')
          : read(relativePath);
      const readWithoutOptionPreservation = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace('preserves-operation-options', 'removed-option-preservation')
          : read(relativePath);

      // When
      const runMergeGuard = () => enforceMongooseNestjsMigrationDocs(readWithoutAmbientSessionMerge);
      const runPreservationGuard = () =>
        enforceMongooseNestjsMigrationDocs(readWithoutOptionPreservation);

      // Then
      expect(runMergeGuard).toThrow(driftedPath);
      expect(runPreservationGuard).toThrow(driftedPath);
    },
  );

  it.each([
    [explicitDiExamplePaths[0], ''],
    [explicitDiExamplePaths[1], ''],
    [explicitDiExamplePaths[2], 'export '],
    [explicitDiExamplePaths[3], 'export '],
  ] as const)(
    'rejects missing explicit DI or swapped declaration order in %s',
    (driftedPath, exportPrefix) => {
      // Given
      const repositoryDecorator = `@Inject(MongooseConnection)\n${exportPrefix}class UserRepository`;
      const serviceDecorator = `@Inject(UserRepository)\n${exportPrefix}class UserService`;
      const readWithoutRepositoryDecorator = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace('@Inject(MongooseConnection)', '@Inject()')
          : read(relativePath);
      const readWithSwappedDeclarations = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath)
              .replace(repositoryDecorator, '[repository declaration]')
              .replace(serviceDecorator, repositoryDecorator)
              .replace('[repository declaration]', serviceDecorator)
          : read(relativePath);

      // When
      const runMissingDecoratorGuard = () =>
        enforceMongooseNestjsMigrationDocs(readWithoutRepositoryDecorator);
      const runSwappedDeclarationsGuard = () =>
        enforceMongooseNestjsMigrationDocs(readWithSwappedDeclarations);

      // Then
      expect(runMissingDecoratorGuard).toThrow(driftedPath);
      expect(runSwappedDeclarationsGuard).toThrow(driftedPath);
    },
  );
});
