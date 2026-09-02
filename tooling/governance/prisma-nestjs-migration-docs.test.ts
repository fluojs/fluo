import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  enforcePrismaNestjsMigrationDocs,
  hasDirectMainBodyPrismaMigrationGuardCall,
} from './prisma-nestjs-migration-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

const prismaVisibilityCodeAnchors = [
  {
    path: 'docs/getting-started/migrate-from-nestjs.md',
    anchors: [
      "import { Global, Module } from '@fluojs/core';",
      '@Global()',
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
      "import { Global, Module } from '@fluojs/core';",
      '@Global()',
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
      const readWithMutatedCodeAnchor = (relativePath: string): string =>
        relativePath === path ? read(relativePath).replace(anchor, replacement) : read(relativePath);

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
    expect(runGovernanceGuard).toThrow('complete @Global() Prisma visibility example');
  });

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
