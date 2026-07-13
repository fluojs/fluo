import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { enforceReactRscGraduationEvidenceUpdates } from './react-rsc-graduation-policy.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const reactPackageManifestPath = 'packages/react/package.json';
const englishPolicyPath = 'docs/contracts/react-rsc-graduation.md';
const koreanPolicyPath = 'docs/contracts/react-rsc-graduation.ko.md';
const concreteEvidencePaths = [
  'packages/react/src/rsc.ts',
  'packages/react/src/experimental/rsc.ts',
  'packages/react/src/rsc-dual-import.test.ts',
  'packages/react/src/rsc-dual-import.types.test.ts',
  'packages/react/src/rsc-hydration.test.ts',
  'packages/react/src/rsc-data-safety.test.ts',
  'packages/react/src/rsc-runtime-bundler-matrix.test.ts',
] as const;
const executableEvidencePaths = concreteEvidencePaths.slice(2);
const companionPaths = [
  englishPolicyPath,
  koreanPolicyPath,
  'docs/CONTEXT.md',
  'docs/CONTEXT.ko.md',
  'docs/README.md',
  'docs/README.ko.md',
  'docs/reference/package-chooser.md',
  'docs/reference/package-chooser.ko.md',
  'docs/reference/package-surface.md',
  'docs/reference/package-surface.ko.md',
  'packages/react/README.md',
  'packages/react/README.ko.md',
  'tooling/governance/react-rsc-discoverability.test.ts',
  'tooling/governance/react-rsc-graduation-evidence.test.ts',
  'tooling/governance/react-rsc-graduation-policy.mjs',
] as const;
const completeChangedFiles = [
  reactPackageManifestPath,
  ...companionPaths,
  ...concreteEvidencePaths,
  '.changeset/react-rsc-stable.md',
];

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function stableGraduationSources(overrides: Readonly<Record<string, string>> = {}) {
  const sources: Readonly<Record<string, string>> = {
    [reactPackageManifestPath]: JSON.stringify({
      exports: {
        './experimental/rsc': {
          import: './dist/experimental/rsc.js',
          types: './dist/experimental/rsc.d.ts',
        },
        './rsc': { import: './dist/rsc.js', types: './dist/rsc.d.ts' },
      },
    }),
    [englishPolicyPath]:
      '**Status: Graduation approved.** [Maintainer approval](https://github.com/fluojs/fluo/issues/2502#issuecomment-1)',
    [koreanPolicyPath]:
      '**Status: Graduation approved.** [Maintainer approval](https://github.com/fluojs/fluo/issues/2502#issuecomment-1)',
    'packages/react/src/rsc.ts': "export { createReactFlightResponse } from './rsc/index.js';",
    'packages/react/src/experimental/rsc.ts': "export * from '../rsc.js';",
    'packages/react/src/rsc-dual-import.test.ts':
      "import * as stable from '@fluojs/react/rsc'; import * as experimental from '@fluojs/react/experimental/rsc'; expect(stable).toEqual(experimental);",
    'packages/react/src/rsc-dual-import.types.test.ts':
      "import * as stable from '@fluojs/react/rsc'; import * as experimental from '@fluojs/react/experimental/rsc'; expectTypeOf(stable).toEqualTypeOf(experimental);",
    'packages/react/src/rsc-hydration.test.ts': "it('covers hydration mismatch recovery', () => {});",
    'packages/react/src/rsc-data-safety.test.ts':
      "it('covers safe transfer for private no-store cookie data', () => {});",
    'packages/react/src/rsc-runtime-bundler-matrix.test.ts':
      "it('covers each supported runtime and bundler matrix entry', () => {});",
    ...overrides,
  };

  return (relativePath: string): string => sources[relativePath] ?? read(relativePath);
}

describe('React RSC graduation evidence gate', () => {
  it('keeps the current pre-graduation manifest passing without stable evidence', () => {
    // Given: only the current experimental RSC export exists.
    const changedFiles = [reactPackageManifestPath];

    // When/Then: stable-only evidence requirements do not apply yet.
    expect(() => enforceReactRscGraduationEvidenceUpdates(changedFiles)).not.toThrow();
  });

  it('rejects a docs-and-tooling-only stable graduation attempt', () => {
    // Given: the stable export, docs, governance, and changeset changed without package implementation evidence.
    const docsAndToolingOnly = [reactPackageManifestPath, ...companionPaths, '.changeset/react-rsc-stable.md'];

    // When/Then: a changed-file list cannot substitute policy prose for a concrete stable entrypoint.
    expect(() =>
      enforceReactRscGraduationEvidenceUpdates(docsAndToolingOnly, stableGraduationSources()),
    ).toThrowError(/packages\/react\/src\/rsc\.ts/);
  });

  it.each(concreteEvidencePaths)('rejects a stable graduation attempt missing %s', (missingPath) => {
    // Given: an otherwise complete graduation evidence set is missing one executable package artifact.
    const incompleteChangedFiles = completeChangedFiles.filter((relativePath) => relativePath !== missingPath);

    // When/Then: every concrete implementation, compatibility, safety, and matrix artifact is mandatory.
    expect(() =>
      enforceReactRscGraduationEvidenceUpdates(incompleteChangedFiles, stableGraduationSources()),
    ).toThrowError(missingPath);
  });

  it('rejects an empty stable entrypoint implementation', () => {
    // Given: every required path changed but the canonical stable implementation is empty.
    const readText = stableGraduationSources({ 'packages/react/src/rsc.ts': '   ' });

    // When/Then: path-only evidence cannot satisfy the concrete implementation gate.
    expect(() => enforceReactRscGraduationEvidenceUpdates(completeChangedFiles, readText)).toThrowError(
      /stable RSC entrypoint must contain an implementation export/,
    );
  });

  it.each(executableEvidencePaths)('rejects non-executable evidence in %s', (evidencePath) => {
    // Given: every required path changed but one package evidence test is empty.
    const readText = stableGraduationSources({ [evidencePath]: '   ' });

    // When/Then: changed-file presence alone cannot satisfy executable graduation evidence.
    expect(() => enforceReactRscGraduationEvidenceUpdates(completeChangedFiles, readText)).toThrowError(evidencePath);
  });

  it('rejects approval prose without a maintainer approval link', () => {
    // Given: both policy mirrors claim approval but contain no GitHub approval record link.
    const readText = stableGraduationSources({
      [englishPolicyPath]: '**Status: Graduation approved.** Maintainer approval pending link.',
      [koreanPolicyPath]: '**Status: Graduation approved.** Maintainer approval pending link.',
    });

    // When/Then: approval must be backed by an explicit issue comment or pull-request review target.
    expect(() => enforceReactRscGraduationEvidenceUpdates(completeChangedFiles, readText)).toThrowError(
      /maintainer approval link/,
    );
  });

  it('rejects a blocked policy even when it contains an approval-shaped link', () => {
    // Given: both policy mirrors remain blocked despite linking an approval-shaped record.
    const blockedPolicy =
      '**Status: Policy defined; graduation blocked.** [Maintainer approval](https://github.com/fluojs/fluo/issues/2502#issuecomment-1)';
    const readText = stableGraduationSources({
      [englishPolicyPath]: blockedPolicy,
      [koreanPolicyPath]: blockedPolicy,
    });

    // When/Then: explicit approval requires the machine-checkable approved status as well as a link.
    expect(() => enforceReactRscGraduationEvidenceUpdates(completeChangedFiles, readText)).toThrowError(
      /Status: Graduation approved/,
    );
  });

  it('accepts a complete implementation, executable evidence, release intent, and approval set', () => {
    // Given: stable implementation, dual-import, hydration, data-safety, matrix, docs, release, and approval evidence.
    const readText = stableGraduationSources();

    // When/Then: the path-sensitive graduation evidence gate accepts the complete set.
    expect(() => enforceReactRscGraduationEvidenceUpdates(completeChangedFiles, readText)).not.toThrow();
  });
});
