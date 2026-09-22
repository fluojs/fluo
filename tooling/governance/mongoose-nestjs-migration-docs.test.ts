import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceMongooseNestjsMigrationDocs } from './mongoose-nestjs-migration-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const mongooseContract =
  'fluo-mongoose-contract: application-owned-connection, ambient-session-merge, preserves-operation-options, strict-fail-open, explicit-target';
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
const saveDocumentContract =
  'fluo-mongoose-save-document-contract: opt-in, active-session, save-compatible-document';
const mongooseRemovalClaim =
  'fluo-mongoose-removal: registration=for-root-or-for-root-async; providers=removed; request-transaction-interceptor=removed';
const mongooseRemovalRequirements = [
  { path: 'packages/mongoose/README.md', heading: '# @fluojs/mongoose' },
  { path: 'packages/mongoose/README.ko.md', heading: '# @fluojs/mongoose' },
  { path: 'apps/docs/content/docs/guides/persistence.mdx', heading: '## Mongoose' },
] as const;
const mongooseFacadeExamplePaths = [
  'apps/docs/content/docs/guides/persistence.mdx',
] as const;
const saveDocumentRequirements = [
  {
    path: 'packages/mongoose/README.md',
    typeConstraint: '  save(options?: UserDocumentSaveOptions): Promise<UserDocument>;',
  },
  {
    path: 'packages/mongoose/README.ko.md',
    typeConstraint: '  save(options?: UserDocumentSaveOptions): Promise<UserDocument>;',
  },
] as const;
const saveDocumentMigrationRequirements = [
  {
    path: 'docs/getting-started/migrate-from-nestjs.md',
    injection: '@Inject(MongooseConnection)\nclass ProfileService',
  },
  {
    path: 'docs/getting-started/migrate-from-nestjs.ko.md',
    injection: '@Inject(MongooseConnection)\nclass ProfileService',
  },
] as const;

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function mongooseContractMarkerFor(relativePath: string): string {
  return relativePath.endsWith('.mdx')
    ? `{/* ${mongooseContract} */}`
    : `<!-- ${mongooseContract} -->`;
}

function saveDocumentContractMarker(): string {
  return `<!-- ${saveDocumentContract} -->`;
}

function mongooseRemovalClaimMarkerFor(relativePath: string): string {
  return relativePath.endsWith('.mdx')
    ? `{/* ${mongooseRemovalClaim} */}`
    : `<!-- ${mongooseRemovalClaim} -->`;
}

describe('NestJS Mongoose migration documentation', () => {
  it('keeps the Mongoose migration and transaction contracts synchronized', () => {
    expect(() => enforceMongooseNestjsMigrationDocs()).not.toThrow();
  });

  it.each(governedDocumentationPaths)(
    'rejects a removed machine contract anchor in %s',
    (driftedPath) => {
      const readWithoutContractAnchor = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace(
              mongooseContractMarkerFor(relativePath),
              '[removed Mongoose contract anchor]',
            )
          : read(relativePath);

      expect(() => enforceMongooseNestjsMigrationDocs(readWithoutContractAnchor)).toThrow(
        driftedPath,
      );
      expect(() => enforceMongooseNestjsMigrationDocs(readWithoutContractAnchor)).toThrow(
        'fluo-mongoose-contract',
      );
    },
  );

  it.each(migrationExamplePaths)(
    'rejects a duplicated marker or heading decoy in %s',
    (driftedPath) => {
      const readWithDuplicateMarker = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace(
              mongooseContractMarkerFor(relativePath),
              `${mongooseContractMarkerFor(relativePath)}\n${mongooseContractMarkerFor(relativePath)}`,
            )
          : read(relativePath);
      const readWithHeadingDecoy = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace(/^## (Mongoose .+)$/mu, '### $1')
          : read(relativePath);

      expect(() => enforceMongooseNestjsMigrationDocs(readWithDuplicateMarker)).toThrow(
        driftedPath,
      );
      expect(() => enforceMongooseNestjsMigrationDocs(readWithHeadingDecoy)).toThrow(driftedPath);
    },
  );

  it.each(migrationExamplePaths)(
    'requires both ambient-session merge and option-preservation anchors in %s',
    (driftedPath) => {
      const readWithoutAmbientSessionMerge = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace('ambient-session-merge', 'removed-session-merge')
          : read(relativePath);
      const readWithoutOptionPreservation = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace('preserves-operation-options', 'removed-option-preservation')
          : read(relativePath);

      expect(() => enforceMongooseNestjsMigrationDocs(readWithoutAmbientSessionMerge)).toThrow(
        driftedPath,
      );
      expect(() => enforceMongooseNestjsMigrationDocs(readWithoutOptionPreservation)).toThrow(
        driftedPath,
      );
    },
  );

  it.each(mongooseRemovalRequirements)(
    'rejects a removal-claim marker decoy outside the governed %s region',
    ({ path: driftedPath }) => {
      const marker = mongooseRemovalClaimMarkerFor(driftedPath);
      const readWithDecoy = (relativePath: string): string =>
        relativePath === driftedPath
          ? `${read(relativePath).replace(marker, '[removed removal claim]')}\n${marker}\n`
          : read(relativePath);

      expect(() => enforceMongooseNestjsMigrationDocs(readWithDecoy)).toThrow(driftedPath);
      expect(() => enforceMongooseNestjsMigrationDocs(readWithDecoy)).toThrow(
        'fluo-mongoose-removal',
      );
    },
  );

  it.each(mongooseRemovalRequirements)(
    'rejects a duplicated removal claim in %s',
    ({ path: driftedPath }) => {
      const marker = mongooseRemovalClaimMarkerFor(driftedPath);
      const readWithDuplicate = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace(marker, `${marker}\n${marker}`)
          : read(relativePath);

      expect(() => enforceMongooseNestjsMigrationDocs(readWithDuplicate)).toThrow(driftedPath);
      expect(() => enforceMongooseNestjsMigrationDocs(readWithDuplicate)).toThrow(
        'fluo-mongoose-removal',
      );
    },
  );

  it.each(mongooseRemovalRequirements)(
    'rejects an inverted Mongoose provider-removal claim in %s',
    ({ path: driftedPath }) => {
      const readWithInvertedClaim = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace('providers=removed', 'providers=exported')
          : read(relativePath);

      expect(() => enforceMongooseNestjsMigrationDocs(readWithInvertedClaim)).toThrow(driftedPath);
      expect(() => enforceMongooseNestjsMigrationDocs(readWithInvertedClaim)).toThrow(
        'fluo-mongoose-removal',
      );
    },
  );

  it.each(mongooseRemovalRequirements)(
    'rejects a conflicting duplicate Mongoose removal field in $path',
    ({ path: driftedPath }) => {
      const readWithConflictingDuplicateField = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace(
              'providers=removed',
              'providers=exported; providers=removed',
            )
          : read(relativePath);

      expect(() => enforceMongooseNestjsMigrationDocs(readWithConflictingDuplicateField)).toThrow(
        driftedPath,
      );
      expect(() => enforceMongooseNestjsMigrationDocs(readWithConflictingDuplicateField)).toThrow(
        'must not declare duplicate field keys: providers.',
      );
    },
  );

  it('rejects a disabled MongooseModule barrel export comparison', () => {
    const readWithDisabledBarrelExport = (relativePath: string): string =>
      relativePath === 'packages/mongoose/src/index.ts'
        ? read(relativePath).replace(
            "export * from './module.js';",
            "// export * from './module.js';",
          )
        : read(relativePath);

    expect(() => enforceMongooseNestjsMigrationDocs(readWithDisabledBarrelExport)).toThrow(
      'packages/mongoose/src/index.ts',
    );
    expect(() => enforceMongooseNestjsMigrationDocs(readWithDisabledBarrelExport)).toThrow(
      'MongooseModule barrel export',
    );
  });

  it.each(mongooseFacadeExamplePaths)(
    'rejects a non-facade findById example in %s',
    (driftedPath) => {
      const readWithUnsupportedFacadeMethod = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath)
              .replace('User.findOne({ _id: id })', 'User.findById(id)')
              .replace(
                "type UserModel = MongooseModelFacade<unknown, unknown, Promise<User | null>>;",
                'type UserModel = MongooseModelFacade;',
              )
          : read(relativePath);

      expect(() => enforceMongooseNestjsMigrationDocs(readWithUnsupportedFacadeMethod)).toThrow(
        driftedPath,
      );
      expect(() => enforceMongooseNestjsMigrationDocs(readWithUnsupportedFacadeMethod)).toThrow(
        'MongooseModelFacade.findOne',
      );
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

      expect(() => enforceMongooseNestjsMigrationDocs(readWithoutRepositoryDecorator)).toThrow(
        driftedPath,
      );
      expect(() => enforceMongooseNestjsMigrationDocs(readWithSwappedDeclarations)).toThrow(
        driftedPath,
      );
    },
  );

  it.each(saveDocumentRequirements)(
    'rejects a removed saveDocument machine marker in $path',
    ({ path: driftedPath }) => {
      const readWithoutSaveDocumentMarker = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace(
              saveDocumentContractMarker(),
              '[removed Mongoose saveDocument contract anchor]',
            )
          : read(relativePath);

      expect(() => enforceMongooseNestjsMigrationDocs(readWithoutSaveDocumentMarker)).toThrow(
        driftedPath,
      );
      expect(() => enforceMongooseNestjsMigrationDocs(readWithoutSaveDocumentMarker)).toThrow(
        'fluo-mongoose-save-document-contract',
      );
    },
  );

  it.each(saveDocumentRequirements)(
    'rejects a duplicated saveDocument machine marker in $path',
    ({ path: driftedPath }) => {
      const readWithDuplicateSaveDocumentMarker = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace(
              saveDocumentContractMarker(),
              `${saveDocumentContractMarker()}\n${saveDocumentContractMarker()}`,
            )
          : read(relativePath);

      expect(() => enforceMongooseNestjsMigrationDocs(readWithDuplicateSaveDocumentMarker)).toThrow(
        driftedPath,
      );
      expect(() => enforceMongooseNestjsMigrationDocs(readWithDuplicateSaveDocumentMarker)).toThrow(
        'fluo-mongoose-save-document-contract',
      );
    },
  );

  it.each(saveDocumentRequirements)(
    'rejects a non-save-compatible saveDocument example in $path',
    ({ path: driftedPath, typeConstraint }) => {
      const readWithoutSaveCompatibleType = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace(
              typeConstraint,
              '  [removed save-compatible document type constraint]',
            )
          : read(relativePath);

      expect(() => enforceMongooseNestjsMigrationDocs(readWithoutSaveCompatibleType)).toThrow(
        driftedPath,
      );
      expect(() => enforceMongooseNestjsMigrationDocs(readWithoutSaveCompatibleType)).toThrow(
        'save-compatible document type',
      );
    },
  );

  it.each(saveDocumentMigrationRequirements)(
    'rejects missing explicit ProfileService MongooseConnection injection in $path',
    ({ path: driftedPath, injection }) => {
      const readWithoutProfileServiceInjection = (relativePath: string): string =>
        relativePath === driftedPath
          ? read(relativePath).replace(injection, 'class ProfileService')
          : read(relativePath);

      expect(() => enforceMongooseNestjsMigrationDocs(readWithoutProfileServiceInjection)).toThrow(
        driftedPath,
      );
      expect(() => enforceMongooseNestjsMigrationDocs(readWithoutProfileServiceInjection)).toThrow(
        'ProfileService',
      );
    },
  );
});
