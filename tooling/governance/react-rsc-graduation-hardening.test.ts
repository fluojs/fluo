import { describe, expect, it } from 'vitest';

import * as graduationPolicy from './react-rsc-graduation-policy.mjs';
import {
  approvalRecordPath,
  approvedGraduationSources as approvedSources,
  approvedManifest,
  changesetPath,
  completeChangedFiles,
  englishPolicyPath,
  koreanPolicyPath,
  reactPackageManifestPath,
  readRepositoryText as read,
  repositoryEvidenceCommit,
} from './react-rsc-graduation-test-fixtures.js';

describe('React RSC graduation review hardening', () => {
  it('accepts the complete deterministic graduation contract', () => {
    // Given: approved policy, canonical root targets, observable suites, real ancestry, and exact minor intent.
    const readText = approvedSources();

    // When/Then: the combined gate accepts the complete repository-verifiable evidence set.
    expect(() => graduationPolicy.enforceReactRscGraduationGovernance(completeChangedFiles, readText)).not.toThrow();
  });

  it('enforces the complete policy contract while graduation remains blocked', () => {
    // Given: the blocked record remains authoritative but both policy mirrors erase the governed contract.
    const readText = (relativePath: string): string =>
      relativePath === englishPolicyPath || relativePath === koreanPolicyPath
        ? '**Status: Policy defined; graduation blocked.** Minimal blocked prose.'
        : read(relativePath);

    // When/Then: blocked status preserves the same checklist, deprecation, semver, and root-isolation invariants.
    expect(() => graduationPolicy.enforceReactRscGraduationGovernance([], readText)).toThrowError(
      /Graduation Checklist/,
    );
  });

  it('rejects approved state when the changed manifest omits the literal stable export', () => {
    // Given: the React manifest changed but publishes only root and experimental RSC entrypoints.
    const readText = approvedSources({
      [reactPackageManifestPath]: approvedManifest({ stable: false }),
    });

    // When/Then: approved state requires literal ./rsc before evidence enforcement can return.
    expect(() => graduationPolicy.enforceReactRscGraduationGovernance(completeChangedFiles, readText)).toThrowError(
      /literal .*\.\/rsc.*exact.*types.*import targets/,
    );
  });

  it('rejects a literal stable export whose targets are not exact', () => {
    // Given: the manifest includes ./rsc but redirects its runtime target to the experimental artifact.
    const readText = approvedSources({
      [reactPackageManifestPath]: approvedManifest({
        stableTarget: {
          import: './dist/experimental/rsc.js',
          types: './dist/rsc.d.ts',
        },
      }),
    });

    // When/Then: the literal stable key cannot satisfy approval with noncanonical targets.
    expect(() => graduationPolicy.enforceReactRscGraduationGovernance(completeChangedFiles, readText)).toThrowError(
      /literal .*\.\/rsc.*exact.*types.*import targets/,
    );
  });

  it('rejects approved policy prose that erases the status-independent contract', () => {
    // Given: both mirrors retain only an approved marker and omit the checklist, deprecation, and semver contract.
    const readText = approvedSources({
      [englishPolicyPath]: '**Status: Graduation approved.** Minimal approval prose.',
      [koreanPolicyPath]: '**Status: Graduation approved.** 최소 승인 문구.',
    });

    // When/Then: approved status cannot erase policy invariants.
    expect(() => graduationPolicy.enforceReactRscGraduationGovernance(completeChangedFiles, readText)).toThrowError(
      /Graduation Checklist/,
    );
  });

  it.each([
    [
      'hydration module existence',
      'packages/react/src/rsc-hydration.test.ts',
      "import { expect, it } from 'vitest'; import * as stable from '@fluojs/react/rsc'; it('exists', () => { expect(stable).toBeDefined(); });",
      /observable hydration runtime result/,
    ],
    [
      'data-safety module existence',
      'packages/react/src/rsc-data-safety.test.ts',
      "import { expect, it } from 'vitest'; import * as stable from '@fluojs/react/rsc'; it('exists', () => { expect(stable).toBeDefined(); });",
      /observable data-safety runtime result/,
    ],
    [
      'runtime-bundler module existence',
      'packages/react/src/rsc-runtime-bundler-matrix.test.ts',
      "import { expect, it } from 'vitest'; import * as stable from '@fluojs/react/rsc'; it('exists', () => { expect(stable).toBeDefined(); });",
      /observable runtime\/bundler runtime result/,
    ],
    [
      'hydration self-comparison',
      'packages/react/src/rsc-hydration.test.ts',
      "import { expect, it } from 'vitest'; import * as stable from '@fluojs/react/rsc'; it('compares itself', () => { expect(stable.verifyHydrationContract('hydration mismatch', 'recovery')).toEqual(stable.verifyHydrationContract('hydration mismatch', 'recovery')); });",
      /observable hydration runtime result/,
    ],
    [
      'data-safety self-comparison',
      'packages/react/src/rsc-data-safety.test.ts',
      "import { expect, it } from 'vitest'; import * as stable from '@fluojs/react/rsc'; it('compares itself', () => { expect(stable.verifyDataSafety('private', 'no-store', 'cookie')).toEqual(stable.verifyDataSafety('private', 'no-store', 'cookie')); });",
      /observable data-safety runtime result/,
    ],
    [
      'runtime-bundler self-comparison',
      'packages/react/src/rsc-runtime-bundler-matrix.test.ts',
      "import { expect, it } from 'vitest'; import * as stable from '@fluojs/react/rsc'; it('compares itself', () => { expect(stable.verifyRuntimeBundler('node', 'vite')).toEqual(stable.verifyRuntimeBundler('node', 'vite')); });",
      /observable runtime\/bundler runtime result/,
    ],
  ])('rejects %s as executable evidence', (_caseName, evidencePath, source, errorPattern) => {
    // Given: one required suite uses import-only or tautological evidence instead of a deterministic outcome.
    const readText = approvedSources({ [evidencePath]: source });

    // When/Then: each suite must call its canonical operation and assert its observable result.
    expect(() => graduationPolicy.enforceReactRscGraduationGovernance(completeChangedFiles, readText)).toThrowError(
      errorPattern,
    );
  });

  it('rejects dual-import bindings used only in a tautological matcher argument', () => {
    // Given: both namespaces appear only on the expected side of an assertion whose actual value is constant.
    const readText = approvedSources({
      'packages/react/src/rsc-dual-import.test.ts':
        "import { expect, it } from 'vitest'; import * as stable from '@fluojs/react/rsc'; import * as experimental from '@fluojs/react/experimental/rsc'; it('mentions both', () => { expect(true).toEqual([stable, experimental]); });",
    });

    // When/Then: runtime compatibility requires stable as actual and experimental as expected.
    expect(() => graduationPolicy.enforceReactRscGraduationGovernance(completeChangedFiles, readText)).toThrowError(
      /compare stable runtime exports with experimental runtime exports/,
    );
  });

  it('rejects an approved record when the local repository cannot resolve its evidence commit', () => {
    // Given: a real repository commit is paired with a probe that cannot resolve it as a commit object.
    const readText = approvedSources({
      [approvalRecordPath]: JSON.stringify({
        approval: { evidenceCommit: repositoryEvidenceCommit, maintainer: 'ayden94' },
        issue: 2502,
        schemaVersion: 1,
        status: 'approved',
      }),
    });
    const gitProbe = { commitExists: () => false, isAncestorOfHead: () => true };

    // When/Then: the local read-only git probe rejects fake provenance.
    expect(() =>
      graduationPolicy.enforceReactRscGraduationGovernance(completeChangedFiles, readText, gitProbe),
    ).toThrowError(/evidence commit .* does not exist/);
  });

  it('rejects approval that changes CODEOWNERS in the graduation change set', () => {
    // Given: the graduation diff attempts to rewrite the authority metadata that vouches for its maintainer.
    const readText = approvedSources({ '.github/CODEOWNERS': '* @attacker\n' });

    // When/Then: approval authority must pre-exist the graduation diff.
    expect(() =>
      graduationPolicy.enforceReactRscGraduationGovernance(
        [...completeChangedFiles, '.github/CODEOWNERS'],
        readText,
      ),
    ).toThrowError(/CODEOWNERS.*pre-existing authority/);
  });

  it('rejects an existing evidence commit outside current HEAD ancestry', () => {
    // Given: an injectable read-only probe reports existence but no ancestry.
    const gitProbe = { commitExists: () => true, isAncestorOfHead: () => false };

    // When/Then: detached evidence cannot establish approval provenance.
    expect(() =>
      graduationPolicy.enforceReactRscGraduationGovernance(completeChangedFiles, approvedSources(), gitProbe),
    ).toThrowError(/evidence commit .* ancestor of HEAD/);
  });

  it('rejects mixed React minor and major changesets', () => {
    // Given: one changed changeset declares minor while another escalates the same package to major.
    const majorChangesetPath = '.changeset/react-rsc-major.md';
    const readText = approvedSources({
      [majorChangesetPath]: '---\n"@fluojs/react": major\n---\n\nBreaking React RSC change.\n',
    });

    // When/Then: aggregate Changesets intent must resolve to exactly minor.
    expect(() =>
      graduationPolicy.enforceReactRscGraduationGovernance(
        [...completeChangedFiles, majorChangesetPath],
        readText,
      ),
    ).toThrowError(/aggregate.*@fluojs\/react.*exactly minor/);
  });

  it('rejects unsupported frontmatter lines instead of ignoring them', () => {
    // Given: a changed changeset contains valid minor intent plus an unsupported frontmatter entry.
    const readText = approvedSources({
      [changesetPath]: '---\n"@fluojs/react": minor\nunsupported: value\n---\n\nMalformed metadata.\n',
    });

    // When/Then: every non-comment frontmatter line must use canonical package bump syntax.
    expect(() => graduationPolicy.enforceReactRscGraduationGovernance(completeChangedFiles, readText)).toThrowError(
      /unsupported frontmatter line/,
    );
  });

  it('rejects package root targets that redirect to experimental RSC artifacts', () => {
    // Given: ./rsc is valid but root conditional targets and main redirect consumers to experimental RSC.
    const readText = approvedSources({
      [reactPackageManifestPath]: approvedManifest({
        main: './dist/experimental/rsc.js',
        root: {
          default: './dist/experimental/rsc.js',
          import: './dist/experimental/rsc.js',
          types: './dist/experimental/rsc.d.ts',
        },
        types: './dist/experimental/rsc.d.ts',
      }),
    });

    // When/Then: manifest root targets must remain connected to canonical index artifacts and source isolation.
    expect(() => graduationPolicy.enforceReactRscGraduationGovernance(completeChangedFiles, readText)).toThrowError(
      /root export target.*canonical.*dist\/index/,
    );
  });

  it('rejects a nested conditional root target that redirects to RSC', () => {
    // Given: direct root targets are canonical but a nested browser import resolves to experimental RSC.
    const readText = approvedSources({
      [reactPackageManifestPath]: approvedManifest({
        root: {
          browser: { import: './dist/experimental/rsc.js' },
          default: './dist/index.js',
          node: { import: './dist/index.js' },
          types: './dist/index.d.ts',
        },
      }),
    });

    // When/Then: every nested runtime condition must resolve to the canonical root index artifact.
    expect(() => graduationPolicy.enforceReactRscGraduationGovernance(completeChangedFiles, readText)).toThrowError(
      /root export target.*canonical.*dist\/index/,
    );
  });

  it('rejects a conditional fallback array that can redirect the package root to RSC', () => {
    // Given: the first browser fallback is canonical but a later fallback resolves to experimental RSC.
    const readText = approvedSources({
      [reactPackageManifestPath]: approvedManifest({
        root: {
          browser: ['./dist/index.js', './dist/experimental/rsc.js'],
          import: './dist/index.js',
          types: './dist/index.d.ts',
        },
      }),
    });

    // When/Then: every root conditional fallback leaf must remain on the canonical root artifact.
    expect(() => graduationPolicy.enforceReactRscGraduationGovernance(completeChangedFiles, readText)).toThrowError(
      /root export target.*canonical.*dist\/index/,
    );
  });

  it('rejects a legacy main field that redirects root consumers to RSC', () => {
    // Given: conditional root exports are canonical while the legacy main field targets experimental RSC.
    const readText = approvedSources({
      [reactPackageManifestPath]: approvedManifest({
        main: './dist/experimental/rsc.js',
      }),
    });

    // When/Then: main remains pinned to the canonical root index runtime artifact.
    expect(() => graduationPolicy.enforceReactRscGraduationGovernance(completeChangedFiles, readText)).toThrowError(
      /main.*\.\/dist\/index\.js/,
    );
  });
});
