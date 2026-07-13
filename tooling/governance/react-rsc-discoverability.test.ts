import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as graduationPolicy from './react-rsc-graduation-policy.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(resolve(repoRoot, relativePath), 'utf8');
}

function readWithPackageExports(packageExports: Readonly<Record<string, unknown>>) {
  return (relativePath: string): string =>
    relativePath === 'packages/react/package.json'
      ? JSON.stringify({ exports: packageExports })
      : read(relativePath);
}

describe('experimental React RSC discoverability', () => {
  it('keeps the unstable version, manifest, HTTP dispatch, and root-isolation contracts aligned', () => {
    const englishDocs = [
      read('packages/react/README.md'),
      read('docs/reference/package-surface.md'),
      read('docs/CONTEXT.md'),
    ];
    const koreanDocs = [
      read('packages/react/README.ko.md'),
      read('docs/reference/package-surface.ko.md'),
      read('docs/CONTEXT.ko.md'),
    ];

    for (const source of [...englishDocs, ...koreanDocs]) {
      expect(source).toContain('@fluojs/react/experimental/rsc');
      expect(source).toContain('19.2.6');
      expect(source).toContain('createReactRscManifest(...)');
      expect(source).toContain('createReactFlightResponse(...)');
      expect(source).toContain('server-to-client module map');
      expect(source).toContain('HTTP dispatch');
      expect(source).toContain('Server Functions');
    }

    const packageManifest = read('packages/react/package.json');
    const rootEntrypoint = read('packages/react/src/index.ts');

    expect(packageManifest).toContain('"./experimental/rsc"');
    expect(packageManifest).toContain('"./dist/experimental/rsc.js"');
    expect(rootEntrypoint).not.toContain('./experimental/rsc.js');
  });

  it('keeps stable RSC blocked while publishing the bilingual graduation policy', () => {
    // Given: the package manifest and every governed React RSC policy surface.
    const packageManifest = read('packages/react/package.json');
    const linkedDocs = [
      read('packages/react/README.md'),
      read('packages/react/README.ko.md'),
      read('docs/CONTEXT.md'),
      read('docs/CONTEXT.ko.md'),
      read('docs/README.md'),
      read('docs/reference/package-surface.md'),
      read('docs/reference/package-surface.ko.md'),
      read('docs/reference/package-chooser.md'),
      read('docs/reference/package-chooser.ko.md'),
    ];

    // When: the canonical graduation-policy governance is evaluated.
    graduationPolicy.enforceReactRscGraduationPolicy();

    // Then: stable RSC remains unavailable and the policy is discoverable from both locales.
    expect(packageManifest).not.toContain('"./rsc"');
    for (const source of linkedDocs) {
      expect(source).toContain('react-rsc-graduation');
    }
    expect(read('docs/README.md')).toContain('./contracts/react-rsc-graduation.md');
    expect(read('docs/README.ko.md')).toContain('./contracts/react-rsc-graduation.ko.md');
  });

  it.each(['./rsc', './*', './r*', './*sc', './r*c', './rsc*'])(
    'rejects the export-map key %s while graduation is blocked',
    (exportKey) => {
      // Given: an export map whose literal or wildcard key can resolve the stable RSC subpath.
      const readText = readWithPackageExports({
        './experimental/rsc': {
          import: './dist/experimental/rsc.js',
          types: './dist/experimental/rsc.d.ts',
        },
        [exportKey]: './dist/*.js',
      });

      // When/Then: policy enforcement rejects the bypass instead of checking only a literal key.
      expect(() => graduationPolicy.enforceReactRscGraduationPolicy(readText)).toThrowError(
        /export-map key .* can resolve .*@fluojs\/react\/rsc/,
      );
    },
  );

  it('requires graduation evidence when the React package manifest can resolve stable RSC', () => {
    // Given: a wildcard graduation attempt and progressively more companion files.
    const readText = readWithPackageExports({
      './experimental/rsc': {
        import: './dist/experimental/rsc.js',
        types: './dist/experimental/rsc.d.ts',
      },
      './*': './dist/*.js',
    });
    const documentation = [
      'docs/CONTEXT.md',
      'docs/CONTEXT.ko.md',
      'docs/README.md',
      'docs/README.ko.md',
      'docs/contracts/react-rsc-graduation.md',
      'docs/contracts/react-rsc-graduation.ko.md',
      'docs/reference/package-chooser.md',
      'docs/reference/package-chooser.ko.md',
      'docs/reference/package-surface.md',
      'docs/reference/package-surface.ko.md',
      'packages/react/README.md',
      'packages/react/README.ko.md',
    ];
    const executableEvidence = [
      'tooling/governance/react-rsc-discoverability.test.ts',
      'tooling/governance/react-rsc-graduation-policy.mjs',
    ];

    // When/Then: the manifest path alone cannot bypass docs, tests/tooling, or release evidence.
    expect(() =>
      graduationPolicy.enforceReactRscGraduationEvidenceUpdates(['packages/react/package.json'], readText),
    ).toThrowError(/docs\/contracts\/react-rsc-graduation\.md/);
    expect(() =>
      graduationPolicy.enforceReactRscGraduationEvidenceUpdates(
        ['packages/react/package.json', ...documentation],
        readText,
      ),
    ).toThrowError(/react-rsc-discoverability\.test\.ts/);
    expect(() =>
      graduationPolicy.enforceReactRscGraduationEvidenceUpdates(
        ['packages/react/package.json', ...documentation, ...executableEvidence],
        readText,
      ),
    ).toThrowError(/\.changeset\/\*\.md/);
    expect(() =>
      graduationPolicy.enforceReactRscGraduationEvidenceUpdates(
        ['packages/react/package.json', ...documentation, ...executableEvidence, '.changeset/react-rsc-stable.md'],
        readText,
      ),
    ).not.toThrow();
  });

  it('does not require graduation companions for unrelated React manifest edits', () => {
    // Given: the React manifest path changed without a literal or wildcard stable RSC export.
    const readText = readWithPackageExports({
      './experimental/rsc': {
        import: './dist/experimental/rsc.js',
        types: './dist/experimental/rsc.d.ts',
      },
    });

    // When/Then: the path-sensitive gate leaves unrelated manifest maintenance alone.
    expect(() =>
      graduationPolicy.enforceReactRscGraduationEvidenceUpdates(['packages/react/package.json'], readText),
    ).not.toThrow();
  });
});
