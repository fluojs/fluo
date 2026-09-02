import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  enforceMicroservicesNestjsMigrationDocs,
  hasDirectMainBodyMigrationGuardCall,
} from './microservices-nestjs-migration-docs.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

describe('NestJS microservices migration documentation', () => {
  it('keeps the source-backed migration structure synchronized', () => {
    // Given
    const runGovernanceGuard = () => enforceMicroservicesNestjsMigrationDocs();

    // When / Then
    expect(runGovernanceGuard).not.toThrow();
  });

  it('rejects a source comment that imitates gRPC emit acknowledgement', () => {
    // Given
    const grpcTransportPath = 'packages/microservices/src/transports/grpc-transport.ts';
    const readWithCommentDecoy = (relativePath: string): string =>
      relativePath === grpcTransportPath
        ? read(relativePath).replace(
          'await this.callUnary(parsed, payload, grpcKinds.event, undefined);',
          '// await this.callUnary(parsed, payload, grpcKinds.event, undefined);',
        )
        : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceMicroservicesNestjsMigrationDocs(readWithCommentDecoy);

    // Then
    expect(runGovernanceGuard).toThrow('GrpcMicroserviceTransport.emit()');
  });

  it('rejects a claim moved outside the microservices section', () => {
    // Given
    const documentationPath = 'docs/getting-started/migrate-from-nestjs.md';
    const claim = 'Event patterns fan out to all distinct matching handlers.';
    const readWithOutOfSectionDecoy = (relativePath: string): string =>
      relativePath === documentationPath
        ? read(relativePath)
          .replace(claim, '')
          .replace('### Cache-Manager TTL, Key, Visibility, and Store Ownership Migration', [
            '### Cache-Manager TTL, Key, Visibility, and Store Ownership Migration',
            '',
            `- ${claim}`,
          ].join('\n'))
        : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceMicroservicesNestjsMigrationDocs(readWithOutOfSectionDecoy);

    // Then
    expect(runGovernanceGuard).toThrow('substantive list item');
  });

  it('rejects an HTML-comment documentation decoy', () => {
    // Given
    const documentationPath = 'docs/getting-started/migrate-from-nestjs.md';
    const claim = 'Event patterns fan out to all distinct matching handlers.';
    const readWithCommentDecoy = (relativePath: string): string =>
      relativePath === documentationPath
        ? read(relativePath).replaceAll(claim, `<!-- ${claim} -->`)
        : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceMicroservicesNestjsMigrationDocs(readWithCommentDecoy);

    // Then
    expect(runGovernanceGuard).toThrow('substantive list item');
  });

  it('requires a direct migration-guard call in the main body', () => {
    // Given
    const governanceSource = read('tooling/governance/verify-platform-consistency-governance.mjs');
    const sourceWithNestedUncalledGuard = governanceSource.replace(
      '  enforceMicroservicesNestjsMigrationDocs();',
      '  const runMigrationGuardLater = () => enforceMicroservicesNestjsMigrationDocs();',
    );

    // When / Then
    expect(hasDirectMainBodyMigrationGuardCall(governanceSource)).toBe(true);
    expect(hasDirectMainBodyMigrationGuardCall(sourceWithNestedUncalledGuard)).toBe(false);
  });
});
