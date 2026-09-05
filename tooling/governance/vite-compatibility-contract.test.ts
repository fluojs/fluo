import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

interface PackageManifest {
  readonly devDependencies?: Record<string, string>;
  readonly engines?: Record<string, string>;
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

    expect(rootManifest.engines?.node).toBe('>=20.19.3 <21 || >=22.12.0 <27');
    expect(rootManifest.devDependencies?.vite).toBe('^6.4.3');
    expect(rootManifest.devDependencies?.vite8).toBe('npm:vite@8.0.8');
    expect(viteManifest.peerDependencies?.vite).toBe('>=6.2.0');
  });

  it('rejects a private root Node policy that permits versions unsupported by locked Vite 8', async () => {
    const { enforcePrivateRootToolchainNodeEngineAlignment } = await import(
      './verify-platform-consistency-governance.mjs'
    ) as unknown as {
      enforcePrivateRootToolchainNodeEngineAlignment(readText?: (relativePath: string) => string): void;
    };
    const readText = (relativePath: string) => {
      const content = readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
      if (relativePath !== 'package.json') {
        return content;
      }

      const manifest = JSON.parse(content) as PackageManifest;
      return JSON.stringify({ ...manifest, engines: { node: '>=20.19.3 <21 || >=22.2.0 <27' } });
    };

    expect(() => enforcePrivateRootToolchainNodeEngineAlignment()).not.toThrow();
    expect(() => enforcePrivateRootToolchainNodeEngineAlignment(readText)).toThrow(
      /permits Node 22\.2\.0 but mandatory vite8 locked engines\.node is \^20\.19\.0 \|\| >=22\.12\.0/u,
    );
  });
});
