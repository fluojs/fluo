import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceMongooseNestjsMigrationDocs } from './mongoose-nestjs-migration-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('NestJS Mongoose document-save migration documentation', () => {
  it('keeps the Mongoose document-save migration and transaction contracts synchronized', () => {
    const runGovernanceGuard = () => enforceMongooseNestjsMigrationDocs();

    expect(runGovernanceGuard).not.toThrow();
  });

  it.each([
    [
      'docs/getting-started/migrate-from-nestjs.md',
      '`MongooseConnection.saveDocument(...)` is opt-in',
    ],
    [
      'docs/architecture/transactions.md',
      '| Mongoose document save helper |',
    ],
    [
      'docs/CONTEXT.md',
      '`MongooseConnection.saveDocument(...)` is the opt-in path',
    ],
  ] as const)('rejects a removed Mongoose document-save contract anchor in %s', (driftedPath, requiredMarker) => {
    const readWithoutContractAnchor = (relativePath: string): string =>
      relativePath === driftedPath
        ? read(relativePath).replace(requiredMarker, '[removed Mongoose document-save contract anchor]')
        : read(relativePath);

    const runGovernanceGuard = () => enforceMongooseNestjsMigrationDocs(readWithoutContractAnchor);

    expect(runGovernanceGuard).toThrow(driftedPath);
    expect(runGovernanceGuard).toThrow(requiredMarker);
  });
});
