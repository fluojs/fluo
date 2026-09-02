import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  enforceMicroservicesNestjsMigrationDocs,
  hasDirectMainBodyMigrationGuardCall,
} from './microservices-nestjs-migration-docs.mjs';
import { enforceMicroservicesRuntimeEvidence } from './microservices-nestjs-migration-runtime-evidence.mjs';

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

  it.each([
    {
      expectedError: 'GrpcMicroserviceTransport.emit()',
      mutate: (source: string) => source.replace(
        '    await this.callUnary(parsed, payload, grpcKinds.event, undefined);',
        [
          '    const acknowledgeLater = async () => {',
          '      await this.callUnary(parsed, payload, grpcKinds.event, undefined);',
          '    };',
        ].join('\n'),
      ),
      path: 'packages/microservices/src/transports/grpc-transport.ts',
    },
    {
      expectedError: 'RedisPubSubMicroserviceTransport.send()',
      mutate: (source: string) => source.replace(
        "    throw new Error('RedisPubSubMicroserviceTransport does not support request/reply send(). Use emit() or a transport with durable request/reply semantics.');",
        [
          '    const rejectLater = function (): never {',
          "      throw new Error('RedisPubSubMicroserviceTransport does not support request/reply send(). Use emit() or a transport with durable request/reply semantics.');",
          '    };',
          '    return undefined;',
        ].join('\n'),
      ),
      path: 'packages/microservices/src/transports/redis-transport.ts',
    },
    {
      expectedError: 'MicroserviceLifecycleService must reject overlapping',
      mutate: (source: string) => source.replace(
        [
          '        throw new Error(',
          `          \`Multiple message handlers matched pattern "\${packet.pattern}": \${matches`,
          `            .map((descriptor) => \`\${descriptor.targetName}.\${descriptor.methodName}\`)`,
          "            .join(', ')}.`,",
          '        );',
        ].join('\n'),
        [
          '        function rejectOverlapsLater(): never {',
          '          throw new Error(',
          `            \`Multiple message handlers matched pattern "\${packet.pattern}": \${matches`,
          `              .map((descriptor) => \`\${descriptor.targetName}.\${descriptor.methodName}\`)`,
          "              .join(', ')}.`,",
          '          );',
          '        }',
          '        return undefined;',
        ].join('\n'),
      ),
      path: 'packages/microservices/src/service.ts',
    },
    {
      expectedError: 'MicroserviceLifecycleService must fan out',
      mutate: (source: string) => source
        .replace(
          [
            '    const singletonResults = await Promise.allSettled(',
            '      singletonDescriptors.map((descriptor) => this.invokeHandler(descriptor, cloneWithFallback(payload))),',
            '    );',
          ].join('\n'),
          [
            '    class FanoutLater {',
            '      async collect(): Promise<PromiseSettledResult<unknown>[]> {',
            '        return await Promise.allSettled(',
            '          singletonDescriptors.map((descriptor) => this.invokeHandler(descriptor, cloneWithFallback(payload))),',
            '        );',
            '      }',
            '    }',
            '    const singletonResults = [];',
          ].join('\n'),
        )
        .replace(
          [
            '      const scopedResults = await Promise.allSettled(',
            '        scopedDescriptors.map((descriptor) =>',
            '    this.invokeResolvedHandlerInScope(perEventScope, descriptor, cloneWithFallback(payload)),',
            '        ),',
            '      );',
          ].join('\n'),
          '      const scopedResults = [];',
        ),
      path: 'packages/microservices/src/service.ts',
    },
    {
      expectedError: 'MicroserviceLifecycleService must suppress only repeated',
      mutate: (source: string) => source.replace(
        [
          '        if (this.isDuplicate(seen, candidate.targetType, entry.propertyKey, dedupeKey)) {',
        ].join('\n'),
        [
          '        const shouldDedupeLater = () =>',
          '          this.isDuplicate(seen, candidate.targetType, entry.propertyKey, dedupeKey);',
          '        if (false) {',
        ].join('\n'),
      ),
      path: 'packages/microservices/src/service.ts',
    },
  ])('rejects uncalled nested executable-scope decoy for $expectedError', ({
    expectedError,
    mutate,
    path,
  }) => {
    // Given
    const readWithNestedDecoy = (relativePath: string): string =>
      relativePath === path ? mutate(read(relativePath)) : read(relativePath);

    // When
    const runGovernanceGuard = () => enforceMicroservicesRuntimeEvidence(readWithNestedDecoy);

    // Then
    expect(runGovernanceGuard).toThrow(expectedError);
  });
});
