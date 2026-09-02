import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceMongooseNestjsMigrationDocs } from './mongoose-nestjs-migration-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

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

  it.each([
    [
      'docs/getting-started/migrate-from-nestjs.md',
      '`MongooseConnection.model(...)` merges the ambient session',
    ],
    [
      'docs/architecture/transactions.md',
      '| Mongoose decorator target selection |',
    ],
    [
      'docs/architecture/transactions.md',
      'Mongoose fail-open fallback applies only',
    ],
  ] as const)('rejects a removed Mongoose contract anchor in %s', (driftedPath, requiredMarker) => {
    // Given
    const readWithoutContractAnchor = (relativePath: string): string =>
      relativePath === driftedPath
        ? read(relativePath).replace(requiredMarker, '[removed Mongoose contract anchor]')
        : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceMongooseNestjsMigrationDocs(readWithoutContractAnchor);

    // Then
    expect(runGovernanceGuard).toThrow(driftedPath);
    expect(runGovernanceGuard).toThrow(requiredMarker);
  });
});
