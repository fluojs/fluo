import { describe, expect, it } from 'vitest';

import { enforceContractCompanionUpdates } from './verify-platform-consistency-governance.mjs';

describe('NestJS parity contract companions', () => {
  it('requires bilingual context and governance companions for a parity correction', () => {
    // Given: the bilingual NestJS metrics migration and parity-gap contract set.
    const changedFiles = [
      'docs/getting-started/migrate-from-nestjs.md',
      'docs/getting-started/migrate-from-nestjs.ko.md',
      'docs/contracts/nestjs-parity-gaps.md',
      'docs/contracts/nestjs-parity-gaps.ko.md',
      'docs/getting-started/migrate-from-fastify.md',
      'docs/getting-started/migrate-from-fastify.ko.md',
      'packages/platform-fastify/README.md',
      'packages/platform-fastify/README.ko.md',
      'packages/platform-fastify/src/adapter.test.ts',
    ];
    const unchangedEmailMigrationSection = [
      '## Email migration',
      '',
      '<!-- fluo-email-nestjs-migration: async=injected-factory->supported;delivery=direct->pre-rendered,template->rendered -->',
      '',
      'Use `EmailService.send(...)` for direct delivery.',
    ].join('\n');
    const snapshots = {
      'packages/email/README.md': {
        base: unchangedEmailMigrationSection,
        head: unchangedEmailMigrationSection,
      },
      'packages/email/README.ko.md': {
        base: unchangedEmailMigrationSection,
        head: unchangedEmailMigrationSection,
      },
      'docs/getting-started/migrate-from-nestjs.md': {
        base: unchangedEmailMigrationSection,
        head: unchangedEmailMigrationSection,
      },
      'docs/getting-started/migrate-from-nestjs.ko.md': {
        base: unchangedEmailMigrationSection,
        head: unchangedEmailMigrationSection,
      },
    };

    // When: the correction omits or includes its machine-governed companions.
    // Then: governance rejects the incomplete set and accepts the complete set.
    expect(() => enforceContractCompanionUpdates(changedFiles, snapshots)).toThrow(/docs\/CONTEXT\.md/u);
    expect(() =>
      enforceContractCompanionUpdates([
        ...changedFiles,
        'docs/CONTEXT.md',
        'docs/CONTEXT.ko.md',
        'tooling/governance/nestjs-parity-contract-companions.test.ts',
      ], snapshots),
    ).not.toThrow();
  });
});
