import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceCronNestjsMigrationDocs } from './cron-nestjs-migration-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationPropositions = [
  'timezone-mapping',
  'wait-for-completion',
  'unsupported-options',
  'absolute-time',
  'named-interval-timeout',
  'async-configuration',
  'global-visibility',
  'category-switches',
] as const;
const migrationDocumentationSurfaces = [
  'packages/cron/README.md',
  'packages/cron/README.ko.md',
  'docs/getting-started/migrate-from-nestjs.md',
  'docs/getting-started/migrate-from-nestjs.ko.md',
  'docs/contracts/nestjs-parity-gaps.md',
  'docs/contracts/nestjs-parity-gaps.ko.md',
  'book/intermediate/ch12-cron.md',
  'book/intermediate/ch12-cron.ko.md',
  'docs/CONTEXT.md',
  'docs/CONTEXT.ko.md',
] as const;

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('NestJS schedule migration documentation', () => {
  it('keeps the source-backed migration identifiers synchronized', () => {
    expect(() => enforceCronNestjsMigrationDocs()).not.toThrow();
  });

  it.each(
    migrationDocumentationSurfaces.flatMap((relativePath) =>
      migrationPropositions.map((proposition) => [relativePath, proposition] as const),
    ),
  )('reports the missing %s migration proposition in %s', (driftedPath, proposition) => {
    const marker = `<!-- fluo:cron-nestjs-migration: ${proposition} -->`;
    const readWithoutMigrationProposition = (relativePath: string): string =>
      relativePath === driftedPath ? read(relativePath).replace(marker, '') : read(relativePath);

    const runGovernanceGuard = () => enforceCronNestjsMigrationDocs(readWithoutMigrationProposition);

    expect(runGovernanceGuard).toThrow(driftedPath);
    expect(runGovernanceGuard).toThrow(proposition);
  });
});
