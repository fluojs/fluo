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

  it('rejects an English rollback claim moved outside the Prisma section', () => {
    // Given
    const documentationPath = 'docs/getting-started/migrate-from-nestjs.md';
    const claim = 'Set `strictTransactions: true` whenever migrated business work requires rollback atomicity.';
    const readWithOutOfSectionDecoy = (relativePath: string): string =>
      relativePath === documentationPath
        ? read(relativePath)
          .replace(claim, '')
          .replace('### Prisma Request-Wide Transaction Migration', [
            '### Prisma Request-Wide Transaction Migration',
            '',
            claim,
          ].join('\n'))
        : read(relativePath);

    // When
    const runGovernanceGuard = () => enforcePrismaNestjsMigrationDocs(readWithOutOfSectionDecoy);

    // Then
    expect(runGovernanceGuard).toThrow('within its Prisma async registration section');
  });

  it('rejects a Korean async-registration claim hidden in a comment', () => {
    // Given
    const documentationPath = 'docs/getting-started/migrate-from-nestjs.ko.md';
    const claim = 'NestJS의 `imports`, `useClass`, `useExisting`은 `forRootAsync(...)` 호환 field가 아닙니다.';
    const readWithCommentDecoy = (relativePath: string): string =>
      relativePath === documentationPath
        ? read(relativePath).replace(claim, `<!-- ${claim} -->`)
        : read(relativePath);

    // When
    const runGovernanceGuard = () => enforcePrismaNestjsMigrationDocs(readWithCommentDecoy);

    // Then
    expect(runGovernanceGuard).toThrow('within its Prisma async registration section');
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
