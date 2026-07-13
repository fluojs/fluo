import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as graduationPolicy from './react-rsc-graduation-policy.mjs';

const { enforceReactRscGraduationEvidenceUpdates } = graduationPolicy;

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const reactPackageManifestPath = 'packages/react/package.json';
const englishPolicyPath = 'docs/contracts/react-rsc-graduation.md';
const koreanPolicyPath = 'docs/contracts/react-rsc-graduation.ko.md';
const approvalRecordPath = 'tooling/governance/react-rsc-graduation-approval.json';
const changesetPath = '.changeset/react-rsc-stable.md';
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
  approvalRecordPath,
] as const;
const completeChangedFiles = [
  reactPackageManifestPath,
  ...companionPaths,
  ...concreteEvidencePaths,
  changesetPath,
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
      '**Status: Graduation approved.** The repository-owned approval record is authoritative. [Decision context](https://github.com/fluojs/fluo/issues/2502#issuecomment-1)',
    [koreanPolicyPath]:
      '**Status: Graduation approved.** 저장소 소유 approval record가 authoritative합니다. [Decision context](https://github.com/fluojs/fluo/issues/2502#issuecomment-1)',
    [approvalRecordPath]: JSON.stringify({
      approval: { evidenceCommit: 'a'.repeat(40), maintainer: 'ayden94' },
      issue: 2502,
      schemaVersion: 1,
      status: 'approved',
    }),
    [changesetPath]: '---\n"@fluojs/react": minor\n---\n\nGraduate the stable RSC subpath.\n',
    'packages/react/src/rsc.ts': "export { createReactFlightResponse } from './rsc/index.js';",
    'packages/react/src/experimental/rsc.ts': "export * from '../rsc.js';",
    'packages/react/src/rsc-dual-import.test.ts':
      "import { expect, it } from 'vitest'; import * as stable from '@fluojs/react/rsc'; import * as experimental from '@fluojs/react/experimental/rsc'; it('matches runtime exports', () => { expect(stable).toEqual(experimental); });",
    'packages/react/src/rsc-dual-import.types.test.ts':
      "import { expectTypeOf, it } from 'vitest'; import * as stable from '@fluojs/react/rsc'; import * as experimental from '@fluojs/react/experimental/rsc'; it('matches declaration exports', () => { expectTypeOf(stable).toEqualTypeOf(experimental); });",
    'packages/react/src/rsc-hydration.test.ts':
      "import { expect, it } from 'vitest'; import * as stable from '@fluojs/react/rsc'; it('covers hydration mismatch recovery', () => { expect(stable).toBeDefined(); });",
    'packages/react/src/rsc-data-safety.test.ts':
      "import { expect, it } from 'vitest'; import * as stable from '@fluojs/react/rsc'; it('covers safe transfer for private no-store cookie data', () => { expect(stable).toBeDefined(); });",
    'packages/react/src/rsc-runtime-bundler-matrix.test.ts':
      "import { expect, it } from 'vitest'; import * as stable from '@fluojs/react/rsc'; it('covers each supported runtime and bundler matrix entry', () => { expect(stable).toBeDefined(); });",
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

  it('rejects string mentions and a discovered no-op test as executable evidence', () => {
    // Given: the runtime compatibility file imports both paths and mentions expect without asserting anything.
    const readText = stableGraduationSources({
      'packages/react/src/rsc-dual-import.test.ts':
        "import { it } from 'vitest'; import * as stable from '@fluojs/react/rsc'; import * as experimental from '@fluojs/react/experimental/rsc'; it('mentions expect without an assertion', () => {}); void stable; void experimental;",
    });

    // When/Then: test discovery plus assertion semantics reject the no-op instead of counting strings.
    expect(() => enforceReactRscGraduationEvidenceUpdates(completeChangedFiles, readText)).toThrowError(
      /executable discovered test with an assertion/,
    );
  });

  it('rejects a tautological assertion that does not observe the imported RSC surfaces', () => {
    // Given: a discovered test imports both paths but only asserts a constant truth.
    const readText = stableGraduationSources({
      'packages/react/src/rsc-dual-import.test.ts':
        "import { expect, it } from 'vitest'; import * as stable from '@fluojs/react/rsc'; import * as experimental from '@fluojs/react/experimental/rsc'; it('asserts a constant', () => { expect(true).toBe(true); }); void stable; void experimental;",
    });

    // When/Then: an assertion counts only when it observes bindings from every required RSC import.
    expect(() => enforceReactRscGraduationEvidenceUpdates(completeChangedFiles, readText)).toThrowError(
      /assertion that observes every required RSC import/,
    );
  });

  it('rejects an arbitrary GitHub-looking URL without an approved repository record', () => {
    // Given: policy prose links a nonexistent GitHub-looking target while the authoritative record stays blocked.
    const readText = stableGraduationSources({
      [englishPolicyPath]:
        '**Status: Graduation approved.** [Maintainer approval](https://github.com/fluojs/fluo/issues/999999#issuecomment-999999)',
      [koreanPolicyPath]:
        '**Status: Graduation approved.** [Maintainer approval](https://github.com/fluojs/fluo/issues/999999#issuecomment-999999)',
      [approvalRecordPath]: JSON.stringify({
        approval: null,
        issue: 2502,
        schemaVersion: 1,
        status: 'blocked',
      }),
    });

    // When/Then: prose and URL shape cannot replace the checked-in machine-readable decision.
    expect(() => enforceReactRscGraduationEvidenceUpdates(completeChangedFiles, readText)).toThrowError(
      /approval record must be approved/,
    );
  });

  it('rejects an approval record attributed to an untrusted identity', () => {
    // Given: the machine-readable record names a login outside the repository's trusted maintainer contract.
    const readText = stableGraduationSources({
      [approvalRecordPath]: JSON.stringify({
        approval: { evidenceCommit: 'b'.repeat(40), maintainer: 'untrusted-contributor' },
        issue: 2502,
        schemaVersion: 1,
        status: 'approved',
      }),
    });

    // When/Then: a syntactically valid record cannot self-assert maintainer authority.
    expect(() => enforceReactRscGraduationEvidenceUpdates(completeChangedFiles, readText)).toThrowError(
      /trusted maintainer/,
    );
  });

  it('accepts a complete implementation, executable evidence, release intent, and approval set', () => {
    // Given: stable implementation, dual-import, hydration, data-safety, matrix, docs, release, and approval evidence.
    const readText = stableGraduationSources();

    // When/Then: the path-sensitive graduation evidence gate accepts the complete set.
    expect(() => enforceReactRscGraduationEvidenceUpdates(completeChangedFiles, readText)).not.toThrow();
  });

  it.each([
    ['an unrelated package minor', '---\n"@fluojs/http": minor\n---\n\nUnrelated feature.\n'],
    ['a React patch', '---\n"@fluojs/react": patch\n---\n\nIncorrect stable RSC bump.\n'],
  ])('rejects %s as stable RSC release evidence', (_caseName, changeset) => {
    // Given: every graduation artifact exists but the changed changeset does not declare React minor intent.
    const readText = stableGraduationSources({ [changesetPath]: changeset });

    // When/Then: only an explicit @fluojs/react minor changeset satisfies stable graduation.
    expect(() => enforceReactRscGraduationEvidenceUpdates(completeChangedFiles, readText)).toThrowError(
      /@fluojs\/react.*minor/,
    );
  });

  it('branches the central graduation gate to approved evidence without running the blocked gate', () => {
    // Given: the authoritative approval record and all stable graduation evidence are complete.
    const readText = stableGraduationSources();

    // When/Then: the combined gate accepts approved state instead of also enforcing blocked policy.
    expect(() => graduationPolicy.enforceReactRscGraduationGovernance(completeChangedFiles, readText)).not.toThrow();
  });

  it('rejects approved status without the React manifest graduation change', () => {
    // Given: the approval record is approved but the changed-file set omits the package manifest.
    const readText = stableGraduationSources();

    // When/Then: approved status cannot bypass the stable export-map evidence trigger.
    expect(() => graduationPolicy.enforceReactRscGraduationGovernance([approvalRecordPath], readText)).toThrowError(
      /approved.*packages\/react\/package\.json/,
    );
  });

  it('rejects a transitive renamed RSC re-export from the stable client in approved state', () => {
    // Given: an approved graduation routes an RSC export through an innocently named bridge and alias.
    const readText = stableGraduationSources({
      'packages/react/src/client.ts': "export { createReactFlightResponse as renderPayload } from './bridge.js';",
      'packages/react/src/bridge.ts': "export { createReactFlightResponse } from './rsc.js';",
    });

    // When/Then: approved state still keeps the client surface RSC-free across transitive aliases.
    expect(() => graduationPolicy.enforceReactRscGraduationGovernance(completeChangedFiles, readText)).toThrowError(
      /stable client.*RSC implementation module/,
    );
  });

  it('wires the central main path through the single status-aware graduation gate', () => {
    // Given: the platform consistency verifier source used by the canonical command.
    const centralGovernance = read('tooling/governance/verify-platform-consistency-governance.mjs');

    // When/Then: main invokes one authoritative branch instead of conflicting sequential gates.
    expect(centralGovernance).toContain('enforceReactRscGraduationGovernance(changedFiles);');
    expect(centralGovernance).not.toMatch(
      /enforceReactRscGraduationEvidenceUpdates\(changedFiles\);\s*enforceReactRscGraduationPolicy\(\);/u,
    );
  });
});
