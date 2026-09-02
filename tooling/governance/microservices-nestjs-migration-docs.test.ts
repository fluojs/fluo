import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSourceFile,
  forEachChild,
  isCallExpression,
  isFunctionDeclaration,
  isIdentifier,
  ScriptKind,
  ScriptTarget,
} from 'typescript';
import { describe, expect, it } from 'vitest';

import { enforceMicroservicesNestjsMigrationDocs } from './microservices-nestjs-migration-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('NestJS microservices migration documentation', () => {
  it('keeps the source-backed migration identifiers synchronized', () => {
    // Given
    const runGovernanceGuard = () => enforceMicroservicesNestjsMigrationDocs();

    // When / Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it.each([
    [
      'packages/microservices/src/transports/redis-transport.ts',
      'RedisPubSubMicroserviceTransport does not support request/reply send()',
    ],
    [
      'packages/microservices/src/service.ts',
      'after shutdown has started',
    ],
    ['packages/microservices/package.json', '"./mqtt"'],
  ] as const)('reports source drift in %s', (driftedPath, expectedMarker) => {
    // Given
    const readWithoutSourceContract = (relativePath: string): string =>
      relativePath === driftedPath ? '' : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceMicroservicesNestjsMigrationDocs(readWithoutSourceContract);

    // Then
    expect(runGovernanceGuard).toThrow(driftedPath);
    expect(runGovernanceGuard).toThrow(expectedMarker);
  });

  it.each([
    'docs/getting-started/migrate-from-nestjs.md',
    'docs/getting-started/migrate-from-nestjs.ko.md',
  ] as const)('reports documentation drift in %s', (driftedPath) => {
    // Given
    const readWithoutMigrationSection = (relativePath: string): string =>
      relativePath === driftedPath ? '' : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceMicroservicesNestjsMigrationDocs(readWithoutMigrationSection);

    // Then
    expect(runGovernanceGuard).toThrow(driftedPath);
    expect(runGovernanceGuard).toThrow('### Microservices Handler and Transport Migration');
  });

  it('invokes the migration guard through central platform governance', () => {
    // Given
    const governanceSource = createSourceFile(
      'verify-platform-consistency-governance.mjs',
      read('tooling/governance/verify-platform-consistency-governance.mjs'),
      ScriptTarget.Latest,
      true,
      ScriptKind.JS,
    );
    let callsMigrationGuard = false;

    // When
    for (const statement of governanceSource.statements) {
      if (!isFunctionDeclaration(statement) || statement.name?.text !== 'main' || statement.body === undefined) {
        continue;
      }

      forEachChild(statement.body, function visit(node): void {
        if (isCallExpression(node) && isIdentifier(node.expression)
          && node.expression.text === 'enforceMicroservicesNestjsMigrationDocs') {
          callsMigrationGuard = true;
        }
        forEachChild(node, visit);
      });
    }

    // Then
    expect(callsMigrationGuard).toBe(true);
  });
});
