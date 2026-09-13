import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  enforcePrismaNestjsMigrationDocs,
  hasDirectMainBodyPrismaMigrationGuardCall,
  hasPrismaRegistrationContractFieldComparison,
} from './prisma-nestjs-migration-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

const prismaVisibilityCodeAnchors = [
  {
    path: 'docs/getting-started/migrate-from-nestjs.md',
    anchors: [
      "import { Module } from '@fluojs/core';",
      '  global: true,',
      '  providers: [DatabaseConfig],',
      '  exports: [DatabaseConfig],',
      'class DatabaseConfigModule {}',
      '    DatabaseConfigModule,',
      '    PrismaModule.forRootAsync({',
      '      inject: [DatabaseConfig],',
      '      useFactory: (config: DatabaseConfig) => ({',
    ],
  },
  {
    path: 'docs/getting-started/migrate-from-nestjs.ko.md',
    anchors: [
      "import { Module } from '@fluojs/core';",
      '  global: true,',
      '  providers: [DatabaseConfig],',
      '  exports: [DatabaseConfig],',
      'class DatabaseConfigModule {}',
      '    DatabaseConfigModule,',
      '    PrismaModule.forRootAsync({',
      '      inject: [DatabaseConfig],',
      '      useFactory: (config: DatabaseConfig) => ({',
    ],
  },
] as const;

const prismaVisibilityCodeAnchorMutations = prismaVisibilityCodeAnchors.flatMap(({ path, anchors }) =>
  anchors.flatMap((anchor) => [
    { path, anchor, replacement: '', mutation: 'removed' },
    { path, anchor, replacement: `${anchor}\n${anchor}`, mutation: 'duplicated' },
  ]),
);

const prismaRegistrationContractMarkers = [
  {
    path: 'docs/getting-started/migrate-prisma-registration.md',
    marker:
      '<!-- fluo-prisma-registration-contract: default-class-token-alias, named-token-isolation, no-transaction-interceptor-export -->',
  },
  {
    path: 'docs/getting-started/migrate-prisma-registration.ko.md',
    marker:
      '<!-- fluo-prisma-registration-contract: default-class-token-alias, named-token-isolation, no-transaction-interceptor-export -->',
  },
  {
    path: 'docs/reference/package-surface.md',
    marker:
      '<!-- fluo-prisma-registration-contract: default-class-token-alias, named-token-isolation, no-transaction-interceptor-export -->',
  },
  {
    path: 'docs/reference/package-surface.ko.md',
    marker:
      '<!-- fluo-prisma-registration-contract: default-class-token-alias, named-token-isolation, no-transaction-interceptor-export -->',
  },
] as const;

const prismaTransactionBoundaryMarkers = [
  {
    path: 'docs/getting-started/migrate-from-nestjs.md',
    marker:
      '<!-- fluo-prisma-transaction-boundary: interceptor=removed;replacement=application-owned-request-transaction -->',
  },
  {
    path: 'docs/getting-started/migrate-from-nestjs.ko.md',
    marker:
      '<!-- fluo-prisma-transaction-boundary: interceptor=removed;replacement=application-owned-request-transaction -->',
  },
] as const;

describe('NestJS Prisma migration documentation', () => {
  it('keeps async registration and rollback guidance synchronized', () => {
    // Given
    const runGovernanceGuard = () => enforcePrismaNestjsMigrationDocs();

    // When / Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it('permits prose rewording while preserving machine-consumed Prisma contract markers', () => {
    // Given
    const guardedDocumentationMarkers = [
      {
        path: 'docs/getting-started/migrate-from-nestjs.md',
        marker:
          '<!-- fluo-prisma-contract: injected-factory-only, top-level-name-global, global-export-visibility, bootstrap-provider-visibility, no-nest-dynamic-options, strict-transaction-rollback -->',
      },
      {
        path: 'docs/getting-started/migrate-from-nestjs.ko.md',
        marker:
          '<!-- fluo-prisma-contract: injected-factory-only, top-level-name-global, global-export-visibility, bootstrap-provider-visibility, no-nest-dynamic-options, strict-transaction-rollback -->',
      },
    ] as const;

    for (const { path, marker } of guardedDocumentationMarkers) {
      const readWithRewordedProse = (relativePath: string): string =>
        relativePath === path
          ? read(relativePath).replace(
              /(<!-- fluo-prisma-contract: [^\n]+ -->\n\n)[^\n]+/u,
              '$1Reworded Prisma migration guidance remains explicit.',
            )
          : read(relativePath);
      const readWithoutMarker = (relativePath: string): string =>
        relativePath === path ? read(relativePath).replace(marker, '') : read(relativePath);
      const readWithDuplicateMarker = (relativePath: string): string =>
        relativePath === path ? read(relativePath).replace(marker, `${marker}\n${marker}`) : read(relativePath);

      // When / Then
      expect(() => enforcePrismaNestjsMigrationDocs(readWithRewordedProse)).not.toThrow();
      expect(() => enforcePrismaNestjsMigrationDocs(readWithoutMarker)).toThrow(
        'fluo-prisma-contract marker',
      );
      expect(() => enforcePrismaNestjsMigrationDocs(readWithDuplicateMarker)).toThrow(
        'fluo-prisma-contract marker',
      );
    }
  });

  it.each(prismaVisibilityCodeAnchorMutations)(
    'rejects $mutation Prisma visibility code anchor $anchor in $path',
    ({ path, anchor, replacement }) => {
    // Given
      const readWithMutatedCodeAnchor = (relativePath: string): string => {
        const markdown = read(relativePath);
        if (relativePath !== path) return markdown;
        const sectionStart = markdown.indexOf('<!-- fluo-prisma-contract:');
        expect(sectionStart).toBeGreaterThanOrEqual(0);
        return markdown.slice(0, sectionStart)
          + markdown.slice(sectionStart).replace(anchor, replacement);
      };

      // When / Then
      expect(() => enforcePrismaNestjsMigrationDocs(readWithMutatedCodeAnchor)).toThrow(
        'code anchor',
      );
    },
  );

  it('rejects parent-only DatabaseConfig registration', () => {
    // Given
    const documentationPath = 'docs/getting-started/migrate-from-nestjs.md';
    const readWithParentOnlyRegistration = (relativePath: string): string =>
      relativePath === documentationPath
        ? read(relativePath)
            .replace('    DatabaseConfigModule,\n', '')
            .replace(
              '  ],\n})\nclass AppModule {}',
              '  ],\n  providers: [DatabaseConfig],\n})\nclass AppModule {}',
            )
        : read(relativePath);

    // When / Then
    expect(() => enforcePrismaNestjsMigrationDocs(readWithParentOnlyRegistration)).toThrow(
      'code anchor',
    );
  });

  it('rejects Prisma visibility anchors split across fenced examples', () => {
    // Given
    const documentationPath = 'docs/getting-started/migrate-from-nestjs.md';
    const readWithSplitVisibilityExample = (relativePath: string): string =>
      relativePath === documentationPath
        ? read(relativePath)
          .replace(
            '    DatabaseConfigModule,\n    PrismaModule.forRootAsync({',
            `    DatabaseConfigModule,
  ],
})
class VisibilityModule {}
\`\`\`

\`\`\`typescript
@Module({
  imports: [
    PrismaModule.forRootAsync({`,
          )
        : read(relativePath);

    // When
    const runGovernanceGuard = () => enforcePrismaNestjsMigrationDocs(readWithSplitVisibilityExample);

    // Then
    expect(runGovernanceGuard).toThrow('complete @Module({ global: true }) Prisma visibility example');
  });

  it.each(prismaRegistrationContractMarkers)(
    'rejects a missing or duplicated Prisma registration contract marker in $path',
    ({ path, marker }) => {
      // Given
      const readWithoutMarker = (relativePath: string): string =>
        relativePath === path ? read(relativePath).replace(marker, '') : read(relativePath);
      const readWithDuplicateMarker = (relativePath: string): string =>
        relativePath === path ? read(relativePath).replace(marker, `${marker}\n${marker}`) : read(relativePath);

      // When / Then
      expect(() => enforcePrismaNestjsMigrationDocs(readWithoutMarker)).toThrow(
        'fluo-prisma-registration-contract marker',
      );
      expect(() => enforcePrismaNestjsMigrationDocs(readWithDuplicateMarker)).toThrow(
        'fluo-prisma-registration-contract marker',
      );
    },
  );

  it.each(prismaRegistrationContractMarkers)(
    'rejects mutated Prisma registration contract semantics in $path',
    ({ path, marker }) => {
      // Given
      const semanticMutations = [
        marker.replace('default-class-token-alias', 'default-class-token-copy'),
        marker.replace('named-token-isolation', 'named-token-sharing'),
        marker.replace('no-transaction-interceptor-export', 'transaction-interceptor-export'),
      ];

      for (const mutatedMarker of semanticMutations) {
        const readWithMutatedMarker = (relativePath: string): string =>
          relativePath === path ? read(relativePath).replace(marker, mutatedMarker) : read(relativePath);

        // When / Then
        expect(() => enforcePrismaNestjsMigrationDocs(readWithMutatedMarker)).toThrow(
          `${path} must declare each machine-consumed Prisma registration contract field exactly once.`,
        );
      }
    },
  );

  it('pins the Prisma registration contract field comparison against disabling mutations', () => {
    // Given
    const guardSource = read('tooling/governance/prisma-nestjs-migration-docs.mjs');
    const sourceWithDisabledComparison = guardSource.replace(
      'prismaRegistrationContractFields.every((field) => fields.includes(field))',
      'true',
    );
    expect(sourceWithDisabledComparison).not.toBe(guardSource);

    // When / Then
    expect(hasPrismaRegistrationContractFieldComparison(guardSource)).toBe(true);
    expect(hasPrismaRegistrationContractFieldComparison(sourceWithDisabledComparison)).toBe(false);
  });

  it.each(prismaTransactionBoundaryMarkers)(
    'rejects a missing or duplicated Prisma transaction boundary marker in $path',
    ({ path, marker }) => {
    // Given
      const readWithoutMarker = (relativePath: string): string =>
        relativePath === path ? read(relativePath).replace(marker, '') : read(relativePath);
      const readWithDuplicateMarker = (relativePath: string): string =>
        relativePath === path ? read(relativePath).replace(marker, `${marker}\n${marker}`) : read(relativePath);

      // When / Then
      expect(() => enforcePrismaNestjsMigrationDocs(readWithoutMarker)).toThrow(
        'fluo-prisma-transaction-boundary marker',
      );
      expect(() => enforcePrismaNestjsMigrationDocs(readWithDuplicateMarker)).toThrow(
        'fluo-prisma-transaction-boundary marker',
      );
    },
  );

  it.each(prismaTransactionBoundaryMarkers)(
    'rejects inline and blockquote Prisma transaction boundary marker decoys in $path',
    ({ path, marker }) => {
      // Given
      const decoys = [`Inline decoy ${marker}`, `> ${marker}`];

      for (const decoy of decoys) {
        const readWithDecoy = (relativePath: string): string =>
          relativePath === path ? read(relativePath).replace(marker, decoy) : read(relativePath);

        // When / Then
        expect(() => enforcePrismaNestjsMigrationDocs(readWithDecoy)).toThrow(
          `${path} must include exactly one fluo-prisma-transaction-boundary marker; found 0.`,
        );
      }
    },
  );

  it.each(prismaTransactionBoundaryMarkers)(
    'rejects duplicate or conflicting Prisma transaction boundary fields in $path',
    ({ path, marker }) => {
      // Given
      const readWithDuplicateField = (relativePath: string): string =>
        relativePath === path
          ? read(relativePath).replace(
              marker,
              '<!-- fluo-prisma-transaction-boundary: interceptor=removed;interceptor=removed;replacement=application-owned-request-transaction -->',
            )
          : read(relativePath);
      const readWithConflictingField = (relativePath: string): string =>
        relativePath === path
          ? read(relativePath).replace(
              marker,
              '<!-- fluo-prisma-transaction-boundary: interceptor=removed;interceptor=retained;replacement=application-owned-request-transaction -->',
            )
          : read(relativePath);

      // When / Then
      expect(() => enforcePrismaNestjsMigrationDocs(readWithDuplicateField)).toThrow(
        'invalid or duplicate interceptor field',
      );
      expect(() => enforcePrismaNestjsMigrationDocs(readWithConflictingField)).toThrow(
        'invalid or duplicate interceptor field',
      );
    },
  );

  it.each(prismaTransactionBoundaryMarkers)(
    'rejects retained or exported Prisma transaction interceptor marker meaning in $path',
    ({ path, marker }) => {
      // Given
      const readWithRetainedInterceptor = (relativePath: string): string =>
        relativePath === path
          ? read(relativePath).replace(
              marker,
              '<!-- fluo-prisma-transaction-boundary: interceptor=retained;replacement=application-owned-request-transaction -->',
            )
          : read(relativePath);
      const readWithExportedInterceptor = (relativePath: string): string =>
        relativePath === path
          ? read(relativePath).replace(
              marker,
              '<!-- fluo-prisma-transaction-boundary: interceptor=exported;replacement=application-owned-request-transaction -->',
            )
          : read(relativePath);

      // When / Then
      expect(() => enforcePrismaNestjsMigrationDocs(readWithRetainedInterceptor)).toThrow(
        'unexpected Prisma transaction boundary fields',
      );
      expect(() => enforcePrismaNestjsMigrationDocs(readWithExportedInterceptor)).toThrow(
        'unexpected Prisma transaction boundary fields',
      );
    },
  );

  it('requires the main governance body to invoke the Prisma guard', () => {
    // Given
    const governanceSource = read('tooling/governance/verify-platform-consistency-governance.mjs');
    const sourceWithNestedUncalledGuard = governanceSource.replace(
      '  enforcePrismaNestjsMigrationDocs();',
      '  const runPrismaMigrationGuardLater = () => enforcePrismaNestjsMigrationDocs();',
    );

    // When / Then
    expect(hasDirectMainBodyPrismaMigrationGuardCall(governanceSource)).toBe(true);
    expect(hasDirectMainBodyPrismaMigrationGuardCall(sourceWithNestedUncalledGuard)).toBe(false);
  });
});
