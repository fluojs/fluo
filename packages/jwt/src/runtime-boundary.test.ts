import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageSourceRoot = dirname(fileURLToPath(import.meta.url));
const packageManifestPath = resolve(packageSourceRoot, '../package.json');
const fixtureSourceRoot = resolve(packageSourceRoot, '../test/runtime-boundary');

const localRuntimeModuleSpecifierPattern =
  /^(?:import|export)\s+(?!type\b)(?:[\s\S]*?\s+from\s+)?['"](\.[^'"]+)['"];?$/gm;

const collectLocalRuntimeImportGraph = async (entryPoint: string): Promise<string[]> => {
  const sourceFiles = [entryPoint];
  const discovered = new Set(sourceFiles);

  for (const sourceFile of sourceFiles) {
    const source = await readFile(sourceFile, 'utf8');

    for (const [, moduleSpecifier] of source.matchAll(localRuntimeModuleSpecifierPattern)) {
      const localSourceFile = resolve(dirname(sourceFile), moduleSpecifier.replace(/\.js$/u, '.ts'));

      if (!discovered.has(localSourceFile)) {
        discovered.add(localSourceFile);
        sourceFiles.push(localSourceFile);
      }
    }
  }

  return sourceFiles;
};

describe('JWT runtime boundary', () => {
  it('does not require @fluojs/runtime from its published dependency graph', async () => {
    const packageManifest = JSON.parse(await readFile(packageManifestPath, 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    expect(packageManifest.dependencies).not.toHaveProperty('@fluojs/runtime');

    for (const sourceFile of await collectLocalRuntimeImportGraph(resolve(packageSourceRoot, 'index.ts'))) {
      const source = await readFile(sourceFile, 'utf8');
      expect(source, `${sourceFile} must not import @fluojs/runtime`).not.toContain('@fluojs/runtime');
    }
  });

  it('follows local re-export chains from an entrypoint', async () => {
    await expect(collectLocalRuntimeImportGraph(resolve(fixtureSourceRoot, 'root.fixture'))).resolves.toEqual([
      resolve(fixtureSourceRoot, 'root.fixture'),
      resolve(fixtureSourceRoot, 'child.fixture'),
      resolve(fixtureSourceRoot, 'crypto.fixture'),
    ]);
  });

  it('keeps node:crypto out of the root import graph until crypto operations execute', async () => {
    const sourceFiles = await collectLocalRuntimeImportGraph(resolve(packageSourceRoot, 'index.ts'));

    for (const sourceFile of sourceFiles) {
      const source = await readFile(sourceFile, 'utf8');
      expect(source, `${sourceFile} must not statically import node:crypto values`).not.toMatch(
        /^import\s+(?!type\b)[^;]*['"]node:crypto['"]/m,
      );
    }
  });
});
