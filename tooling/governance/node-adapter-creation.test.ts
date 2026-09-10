import { describe, expect, it } from 'vitest';

import { enforceContractCompanionUpdates } from './verify-platform-consistency-governance.mjs';

const companions = [
  'docs/reference/package-surface.md',
  'docs/reference/package-surface.ko.md',
  'docs/getting-started/migrate-node-adapter-create.md',
  'docs/getting-started/migrate-node-adapter-create.ko.md',
  'docs/CONTEXT.md',
  'docs/CONTEXT.ko.md',
  'tooling/governance/node-adapter-creation.test.ts',
  'packages/platform-nodejs/src/adapter-create.test.ts',
  'packages/platform-nodejs/src/published-declaration-surface.test.ts',
];

describe('Node adapter creation contract companions', () => {
  it('accepts a discoverable bilingual migration with tooling and runtime regressions', () => {
    expect(() => enforceContractCompanionUpdates(companions)).not.toThrow();
  });

  it.each(['docs/CONTEXT.md', 'docs/CONTEXT.ko.md'])('rejects missing %s discoverability', (missing) => {
    expect(() => enforceContractCompanionUpdates(companions.filter((path) => path !== missing)))
      .toThrow('must include docs/CONTEXT.md and docs/CONTEXT.ko.md discoverability updates');
  });

  it('rejects missing tooling enforcement even with package regression coverage', () => {
    expect(() => enforceContractCompanionUpdates(
      companions.filter((path) => !path.startsWith('tooling/')),
    )).toThrow('must include CI/tooling enforcement updates');
  });

  it('rejects missing regression coverage even with tooling enforcement', () => {
    expect(() => enforceContractCompanionUpdates([
      ...companions.filter((path) => !path.endsWith('.test.ts')),
      'tooling/governance/verify-platform-consistency-governance.mjs',
    ])).toThrow('must include regression test updates for the changed contract surface');
  });
});
