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
    ];

    // When: the correction omits or includes its machine-governed companions.
    // Then: governance rejects the incomplete set and accepts the complete set.
    expect(() => enforceContractCompanionUpdates(changedFiles)).toThrow(/docs\/CONTEXT\.md/u);
    expect(() =>
      enforceContractCompanionUpdates([
        ...changedFiles,
        'docs/CONTEXT.md',
        'docs/CONTEXT.ko.md',
        'tooling/governance/nestjs-parity-contract-companions.test.ts',
      ]),
    ).not.toThrow();
  });
});
