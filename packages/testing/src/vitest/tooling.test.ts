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
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: '@fluojs/demo' }));
  writeFileSync(join(sourceRoot, 'index.ts'), 'export {}');
  writeFileSync(join(sourceRoot, 'feature.ts'), 'export const feature = true;');

  return repoRoot;
}

describe('collectWorkspaceAliases', () => {
  it('caches package manifest scans per repository root and returns defensive copies', () => {
    const repoRoot = createRepoRoot();
    const firstAliases = collectWorkspaceAliases(new URL(`file://${repoRoot}/`));

    expect(firstAliases['@fluojs/demo/feature']).toBe(join(repoRoot, 'packages', 'demo', 'src', 'feature.ts'));

    firstAliases['@fluojs/demo/feature'] = 'mutated';
    rmSync(join(repoRoot, 'packages', 'demo'), { recursive: true });

    const secondAliases = collectWorkspaceAliases(new URL(`file://${repoRoot}/`));
    expect(secondAliases['@fluojs/demo/feature']).toBe(join(repoRoot, 'packages', 'demo', 'src', 'feature.ts'));
  });
});
