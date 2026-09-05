import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  readonly name: string;
  readonly private: boolean;
  readonly engines?: { readonly node?: string };
}

const portablePackages = [
  '@fluojs/config',
  '@fluojs/email',
  '@fluojs/i18n',
  '@fluojs/platform-bun',
  '@fluojs/platform-cloudflare-workers',
  '@fluojs/platform-deno',
  '@fluojs/react',
  '@fluojs/runtime',
];

describe('Node support classification', () => {
  it('sets the Node-bound workspace and public packages to the verified support window', () => {
    // Given: every public package is classified at its manifest boundary.
    const packagesRoot = new URL('../../packages/', import.meta.url);
    const manifests: PackageManifest[] = readdirSync(packagesRoot).map((directory) => JSON.parse(
      readFileSync(new URL(`${directory}/package.json`, packagesRoot), 'utf8'),
    ));
    const root: PackageManifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

    // When: package managers consume the published Node support claims.
    const publicManifests = manifests.filter((manifest) => !manifest.private);
    const omissions = publicManifests.filter((manifest) => manifest.engines?.node === undefined);
    const nodeBound = publicManifests.filter((manifest) => !portablePackages.includes(manifest.name));

    // Then: only the eight portable roots omit engines; all Node claims agree.
    expect(omissions.map((manifest) => manifest.name).sort()).toEqual(portablePackages);
    expect(nodeBound).toHaveLength(34);
    for (const manifest of [root, ...nodeBound]) {
      expect(manifest.engines?.node, manifest.name).toBe('>=24.0.0 <27');
    }
  });
});
