import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceCronNestjsMigrationDocs } from './cron-nestjs-migration-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('NestJS schedule migration documentation', () => {
  it('keeps the source-backed migration identifiers synchronized', () => {
    expect(() => enforceCronNestjsMigrationDocs()).not.toThrow();
  });

  it.each([
    ['packages/cron/README.md', '`utcOffset`, `unrefTimeout`, `disabled`, `threshold`, or `initialDelay`'],
    ['docs/getting-started/migrate-from-nestjs.md', 'ScheduleModule.forRootAsync(...)'],
    ['docs/contracts/nestjs-parity-gaps.md', 'absolute-time `@Cron` inputs'],
    ['book/intermediate/ch12-cron.md', '`@Cron(Date)` and `@Cron(DateTime)`'],
    ['docs/CONTEXT.md', 'NestJS category switches'],
  ] as const)('reports migration-document drift in %s', (driftedPath, expectedMarker) => {
    const readWithoutMigrationContract = (relativePath: string): string =>
      relativePath === driftedPath ? '' : read(relativePath);

    const runGovernanceGuard = () => enforceCronNestjsMigrationDocs(readWithoutMigrationContract);

    expect(runGovernanceGuard).toThrow(driftedPath);
    expect(runGovernanceGuard).toThrow(expectedMarker);
  });
});
