import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { collectWorkspaceAliases } from './tooling.js';

const tempRepoRoots = new Set<string>();

afterEach(() => {
  for (const root of tempRepoRoots) {
    rmSync(root, { force: true, recursive: true });
  }

  tempRepoRoots.clear();
});

function createRepoRoot(): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'fluo-testing-tooling-'));
  const packageRoot = join(repoRoot, 'packages', 'demo');
  const sourceRoot = join(packageRoot, 'src');

  tempRepoRoots.add(repoRoot);
  mkdirSync(sourceRoot, { recursive: true });
  writeFileSync(
    join(packageRoot, 'package.json'),
    JSON.stringify({
      name: '@fluojs/demo',
      exports: {
        '.': {
          types: './dist/index.d.ts',
          import: './dist/index.js',
        },
        './feature': {
          types: './dist/feature.d.ts',
          import: './dist/feature.js',
        },
        './renamed': {
          types: './dist/public-entry.d.ts',
          import: './dist/public-entry.js',
        },
      },
    }),
  );
  writeFileSync(join(sourceRoot, 'index.ts'), 'export {}');
  writeFileSync(join(sourceRoot, 'feature.ts'), 'export const feature = true;');
  writeFileSync(join(sourceRoot, 'public-entry.ts'), 'export const publicEntry = true;');
  writeFileSync(join(sourceRoot, 'private-internal.ts'), 'export const privateInternal = true;');

  return repoRoot;
}

describe('collectWorkspaceAliases', () => {
  it('aliases only package exports and caches defensive copies per repository root', () => {
    const repoRoot = createRepoRoot();
    const firstAliases = collectWorkspaceAliases(new URL(`file://${repoRoot}/`));

    expect(firstAliases['@fluojs/demo']).toBe(join(repoRoot, 'packages', 'demo', 'src', 'index.ts'));
    expect(firstAliases['@fluojs/demo/feature']).toBe(join(repoRoot, 'packages', 'demo', 'src', 'feature.ts'));
    expect(firstAliases['@fluojs/demo/renamed']).toBe(
      join(repoRoot, 'packages', 'demo', 'src', 'public-entry.ts'),
    );
    expect(firstAliases).not.toHaveProperty('@fluojs/demo/private-internal');
    expect(firstAliases).not.toHaveProperty('@fluojs/demo/public-entry');
    expect(Object.keys(firstAliases).indexOf('@fluojs/demo/feature')).toBeLessThan(
      Object.keys(firstAliases).indexOf('@fluojs/demo'),
    );

    firstAliases['@fluojs/demo/feature'] = 'mutated';
    rmSync(join(repoRoot, 'packages', 'demo'), { recursive: true });

    const secondAliases = collectWorkspaceAliases(new URL(`file://${repoRoot}/`));
    expect(secondAliases['@fluojs/demo/feature']).toBe(join(repoRoot, 'packages', 'demo', 'src', 'feature.ts'));
  });
});
