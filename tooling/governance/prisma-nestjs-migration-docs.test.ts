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

  it('rejects removed or duplicated Prisma visibility code anchors', () => {
    // Given
    const documentationPath = 'docs/getting-started/migrate-from-nestjs.md';
    const codeAnchor = 'class DatabaseConfigModule {}';
    const readWithoutCodeAnchor = (relativePath: string): string =>
      relativePath === documentationPath ? read(relativePath).replace(codeAnchor, '') : read(relativePath);
    const readWithDuplicateCodeAnchor = (relativePath: string): string =>
      relativePath === documentationPath
        ? read(relativePath).replace(codeAnchor, `${codeAnchor}\n${codeAnchor}`)
        : read(relativePath);

    // When / Then
    expect(() => enforcePrismaNestjsMigrationDocs(readWithoutCodeAnchor)).toThrow('code anchor');
    expect(() => enforcePrismaNestjsMigrationDocs(readWithDuplicateCodeAnchor)).toThrow('code anchor');
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
