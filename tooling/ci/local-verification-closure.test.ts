import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { buildVerificationPlan, readVerificationManifest, verificationModeForChanges } from './local-verification.mjs';

const identity = {
  baseRef: 'main',
  baseSha: 'b'.repeat(40),
  changedFilesDigest: 'c'.repeat(64),
  diffDigest: 'd'.repeat(64),
  headSha: 'a'.repeat(40),
  mergeBase: 'e'.repeat(40),
  root: '/repo',
  treeSha: 'f'.repeat(40),
};

describe('local verification companion closure', () => {
  it('machine-consumes every companion class without replacing docs or native scope rules', () => {
    // Given
    const manifest = readVerificationManifest();
    const files = [
      'packages/core/package.json',
      'packages/core/src/index.mjs',
      'packages/core/test/global-setup.ts',
      'docs/reference/node-support.md',
      'packages/platform-deno/src/index.ts',
    ];

    // When
    const plan = buildVerificationPlan({ changedFiles: files, identity, manifest });

    // Then
    expect(plan.companionChecks).toEqual([
      'declaration-importers',
      'documentation-governance',
      'global-setup-contract',
      'manifest-lockfile',
      'package-dependency-closure',
      'source-copy-inventory',
    ]);
    expect(plan.commands.map((command) => command.argv.join(' '))).toContain('verify:docs');
    expect(plan.commands.map((command) => command.argv.join(' '))).toContain('test:node-floor');
    expect(plan.commands.map((command) => command.argv.join(' '))).toContain('verify:public-export-tsdoc');
  });

  it('fails closed for unknown and manifest-controlled changes in the shared scope contract', () => {
    // Given
    const manifest = JSON.parse(readFileSync(new URL('./local-verification-manifest.json', import.meta.url), 'utf8'));

    // When
    const unknown = verificationModeForChanges(['unknown.txt'], manifest);
    const manifestChange = verificationModeForChanges(['packages/core/package.json'], manifest);

    // Then
    expect(unknown).toBe('full');
    expect(manifestChange).toBe('full');
    expect(buildVerificationPlan({ changedFiles: ['package.json'], identity, manifest }).mode).toBe('full');
  });
});
