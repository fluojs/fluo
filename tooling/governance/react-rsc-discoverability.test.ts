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

function readWithOverride(relativePath: string, source: string) {
  return (requestedPath: string): string => (requestedPath === relativePath ? source : read(requestedPath));
}

function readWithOverrides(overrides: Readonly<Record<string, string>>) {
  return (relativePath: string): string => overrides[relativePath] ?? read(relativePath);
}

const governedPolicyLinks = [
  ['packages/react/README.md', '../../docs/contracts/react-rsc-graduation.md'],
  ['packages/react/README.ko.md', '../../docs/contracts/react-rsc-graduation.ko.md'],
  ['docs/CONTEXT.md', './contracts/react-rsc-graduation.md'],
  ['docs/CONTEXT.ko.md', './contracts/react-rsc-graduation.ko.md'],
  ['docs/reference/package-surface.md', '../contracts/react-rsc-graduation.md'],
  ['docs/reference/package-surface.ko.md', '../contracts/react-rsc-graduation.ko.md'],
  ['docs/reference/package-chooser.md', '../contracts/react-rsc-graduation.md'],
  ['docs/reference/package-chooser.ko.md', '../contracts/react-rsc-graduation.ko.md'],
  ['docs/README.md', './contracts/react-rsc-graduation.md'],
  ['docs/README.ko.md', './contracts/react-rsc-graduation.ko.md'],
] as const;

function oppositeLocaleTarget(target: string): string {
  return target.endsWith('.ko.md') ? target.replace(/\.ko\.md$/u, '.md') : target.replace(/\.md$/u, '.ko.md');
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

    // When: the canonical graduation-policy governance is evaluated.
    graduationPolicy.enforceReactRscGraduationPolicy();

    // Then: stable RSC remains unavailable and the policy is discoverable from both locales.
    expect(packageManifest).not.toContain('"./rsc"');
  });

  it.each(governedPolicyLinks)(
    'rejects a wrong-locale graduation-policy link in %s',
    (relativePath, localizedTarget) => {
      // Given: a governed surface links the opposite locale instead of its own policy mirror.
      const readText = readWithOverride(
        relativePath,
        `[React RSC graduation policy](${oppositeLocaleTarget(localizedTarget)})`,
      );

      // When/Then: localized link governance rejects the wrong target.
      expect(() => graduationPolicy.enforceReactRscGraduationPolicy(readText)).toThrowError(relativePath);
    },
  );

  it.each(governedPolicyLinks)(
    'rejects a plain-text graduation-policy target in %s',
    (relativePath, localizedTarget) => {
      // Given: a governed surface names the exact localized target without a Markdown link.
      const readText = readWithOverride(relativePath, `React RSC graduation policy: ${localizedTarget}`);

      // When/Then: link governance does not mistake a substring for an actual Markdown link target.
      expect(() => graduationPolicy.enforceReactRscGraduationPolicy(readText)).toThrowError(relativePath);
    },
  );

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

  it('rejects a renamed RSC re-export from the stable root while graduation is blocked', () => {
    // Given: the stable root aliases an experimental RSC symbol under a generic public name.
    const readText = readWithOverrides({
      'packages/react/src/index.ts':
        "export { createReactFlightResponse as renderPayload } from './experimental/rsc.js';",
    });

    // When/Then: module-graph isolation catches the source module despite the public alias.
    expect(() => graduationPolicy.enforceReactRscGraduationPolicy(readText)).toThrowError(
      /stable root.*RSC implementation module/,
    );
  });

  it('rejects a directly declared RSC symbol from the stable root', () => {
    // Given: the stable root declares an RSC-named export without importing an RSC module.
    const readText = readWithOverrides({
      'packages/react/src/index.ts': 'export const ReactRscBridge = Object.freeze({});',
    });

    // When/Then: symbol isolation rejects declarations as well as module re-exports.
    expect(() => graduationPolicy.enforceReactRscGraduationPolicy(readText)).toThrowError(
      /stable root.*RSC symbol ReactRscBridge/,
    );
  });

});
