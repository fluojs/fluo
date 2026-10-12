import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  shouldForceFullVerificationByPath,
  shouldVerifyIsolatedHttpBenchmark,
  shouldVerifyReactAppBenchmark,
  resolveVerificationScope,
} from './detect-pr-verification-scope.mjs';

it('resolveVerificationScope: mixed local dependency protocols -> recursive reverse and build closure', () => {
  const root = mkdtempSync(join(tmpdir(), 'fluo-scope-graph-'));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - packages/*\n  - examples/*\n  - '!packages/excluded'\n");
  const manifests = [
    { directory: 'packages/base', manifest: { name: '@fixture/base', scripts: { build: 'build' } } },
    { directory: 'packages/peer', manifest: { name: '@fixture/peer', peerDependencies: { alias: 'workspace:@fixture/base@*' }, scripts: { build: 'build' } } },
    { directory: 'packages/optional', manifest: { name: '@fixture/optional', optionalDependencies: { '@fixture/peer': '^1.0.0' }, scripts: { build: 'build' } } },
    { directory: 'examples/consumer', manifest: { name: '@fixture/consumer', devDependencies: { linked: 'file:../../packages/optional' } } },
    { directory: 'packages/unrelated', manifest: { name: '@fixture/unrelated' } },
    { directory: 'packages/excluded', manifest: { name: '@fixture/excluded', dependencies: { invalid: 'workspace:*' } } },
  ];
  for (const { directory, manifest } of manifests) {
    mkdirSync(join(root, directory), { recursive: true });
    writeFileSync(join(root, directory, 'package.json'), JSON.stringify(manifest));
  }
  try {
    const result = resolveVerificationScope(['packages/base/src/deleted.ts'], { root });

    expect(result.mode).toBe('scoped');
    expect(result.packageNames).toEqual(['@fixture/base', '@fixture/consumer', '@fixture/optional', '@fixture/peer']);
    expect(result.buildDirectories).toEqual(['packages/base', 'packages/optional', 'packages/peer']);
    expect(resolveVerificationScope(['packages/removed/src/index.ts'], { root }).mode).toBe('full');
    expect(resolveVerificationScope(['packages/base/package.json'], { root }).mode).toBe('full');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('resolveVerificationScope: leaf and foundation changes -> real companion consumers without blanket full', () => {
  const leaf = resolveVerificationScope(['packages/email/src/index.ts']);
  const broad = resolveVerificationScope(['packages/platform-fastify/src/index.ts']);
  const core = resolveVerificationScope(['packages/core/src/index.ts']);

  expect(leaf.mode).toBe('scoped');
  expect(leaf.tasks).toEqual([]);
  expect(broad.mode).toBe('scoped');
  expect(broad.tasks).toEqual(expect.arrayContaining(['starters', 'packed']));
  expect(broad.packageDirectories).toContain('examples/react-vite-ssr');
  expect(core.mode).toBe('scoped');
  expect(core.tasks).toEqual(expect.arrayContaining(['native-bun', 'native-web', 'runtime-floor', 'starters', 'packed']));
});

describe('shouldForceFullVerificationByPath', () => {
  it('treats changeset files as neutral when a package changes', () => {
    const changedFiles = ['packages/http/src/index.ts', '.changeset/quiet-pandas-smile.md'];

    const result = shouldForceFullVerificationByPath(changedFiles);

    expect(result).toBeUndefined();
  });
});

describe('shouldVerifyIsolatedHttpBenchmark', () => {
  it('returns true when the isolated HTTP benchmark graph changes', () => {
    const changedFiles = ['tooling/benchmarks/http-comparison/pnpm-lock.yaml'];

    const result = shouldVerifyIsolatedHttpBenchmark(changedFiles);

    expect(result).toBe(true);
  });

  it('returns false when changes do not touch the isolated HTTP benchmark graph', () => {
    const changedFiles = ['tooling/benchmarks/runtime-module-graph/run.mjs', 'packages/http/src/index.ts'];

    const result = shouldVerifyIsolatedHttpBenchmark(changedFiles);

    expect(result).toBe(false);
  });
});

describe('shouldVerifyReactAppBenchmark', () => {
  it('selects an isolated React comparison change', () => {
    expect(shouldVerifyReactAppBenchmark(['tooling/benchmarks/react-app-comparison/baseline.json'])).toBe(true);
  });

  it('does not enable React comparison for existing HTTP benchmark changes', () => {
    expect(shouldVerifyReactAppBenchmark(['tooling/benchmarks/http-comparison/pnpm-lock.yaml'])).toBe(false);
  });
});
