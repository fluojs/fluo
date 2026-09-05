import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

interface PackageManifest {
  readonly devDependencies?: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
}

async function readManifest(path: URL): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageManifest;
}

describe('@fluojs/vite compatibility contract', () => {
  it('keeps the published peer range paired with the dedicated Vite 8 gate', async () => {
    const [rootManifest, viteManifest] = await Promise.all([
      readManifest(new URL('../../package.json', import.meta.url)),
      readManifest(new URL('../../packages/vite/package.json', import.meta.url)),
    ]);

    expect(rootManifest.devDependencies?.vite).toBe('^6.4.3');
    expect(rootManifest.devDependencies?.vite8).toBe('npm:vite@8.0.8');
    expect(viteManifest.peerDependencies?.vite).toBe('>=6.2.0');
  });
});
