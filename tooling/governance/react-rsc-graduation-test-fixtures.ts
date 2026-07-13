import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const repositoryEvidenceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).trim();
export const reactPackageManifestPath = 'packages/react/package.json';
export const englishPolicyPath = 'docs/contracts/react-rsc-graduation.md';
export const koreanPolicyPath = 'docs/contracts/react-rsc-graduation.ko.md';
export const approvalRecordPath = 'tooling/governance/react-rsc-graduation-approval.json';
export const changesetPath = '.changeset/react-rsc-stable.md';
export const completeChangedFiles = [
  reactPackageManifestPath,
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
  'packages/react/src/rsc.ts',
  'packages/react/src/experimental/rsc.ts',
  'packages/react/src/rsc-dual-import.test.ts',
  'packages/react/src/rsc-dual-import.types.test.ts',
  'packages/react/src/rsc-hydration.test.ts',
  'packages/react/src/rsc-data-safety.test.ts',
  'packages/react/src/rsc-runtime-bundler-matrix.test.ts',
  'tooling/governance/react-rsc-discoverability.test.ts',
  'tooling/governance/react-rsc-graduation-evidence.test.ts',
  'tooling/governance/react-rsc-graduation-hardening.test.ts',
  'tooling/governance/react-rsc-graduation-policy.mjs',
  approvalRecordPath,
  changesetPath,
] as const;

export function readRepositoryText(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

export function approvedManifest(
  options: Readonly<{
    main?: string;
    root?: unknown;
    stable?: boolean;
    stableTarget?: unknown;
    types?: string;
  }> = {},
): string {
  return JSON.stringify({
    exports: {
      '.': options.root ?? { import: './dist/index.js', types: './dist/index.d.ts' },
      './experimental/rsc': {
        import: './dist/experimental/rsc.js',
        types: './dist/experimental/rsc.d.ts',
      },
      ...((options.stable ?? true)
        ? { './rsc': options.stableTarget ?? { import: './dist/rsc.js', types: './dist/rsc.d.ts' } }
        : {}),
    },
    main: options.main ?? './dist/index.js',
    types: options.types ?? './dist/index.d.ts',
  });
}

export function approvedGraduationSources(overrides: Readonly<Record<string, string>> = {}) {
  const sources: Readonly<Record<string, string>> = {
    [reactPackageManifestPath]: approvedManifest(),
    [englishPolicyPath]: readRepositoryText(englishPolicyPath).replace(
      'Status: Policy defined; graduation blocked.',
      'Status: Graduation approved.',
    ),
    [koreanPolicyPath]: readRepositoryText(koreanPolicyPath).replace(
      'Status: Policy defined; graduation blocked.',
      'Status: Graduation approved.',
    ),
    [approvalRecordPath]: JSON.stringify({
      approval: { evidenceCommit: repositoryEvidenceCommit, maintainer: 'ayden94' },
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
      "import { expect, it } from 'vitest'; import * as stable from '@fluojs/react/rsc'; it('recovers a hydration mismatch', () => { expect(stable.verifyHydrationContract('hydration mismatch', 'recovery')).toMatchObject({ recovered: true }); });",
    'packages/react/src/rsc-data-safety.test.ts':
      "import { expect, it } from 'vitest'; import * as stable from '@fluojs/react/rsc'; it('protects private data', () => { expect(stable.verifyDataSafety('private', 'no-store', 'cookie')).toEqual({ safe: true }); });",
    'packages/react/src/rsc-runtime-bundler-matrix.test.ts':
      "import { expect, it } from 'vitest'; import * as stable from '@fluojs/react/rsc'; it('covers a runtime bundler pair', () => { expect(stable.verifyRuntimeBundler('node', 'vite')).toMatchObject({ supported: true }); });",
    ...overrides,
  };

  return (relativePath: string): string => sources[relativePath] ?? readRepositoryText(relativePath);
}
