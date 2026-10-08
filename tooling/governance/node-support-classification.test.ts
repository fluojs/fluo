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
  '@fluojs/persistence',
  '@fluojs/platform-bun',
  '@fluojs/platform-cloudflare-workers',
  '@fluojs/platform-deno',
  '@fluojs/react',
  '@fluojs/runtime',
];

// Babel 8 compiler releases require Node ^22.18.0 || >=24.11.0 upstream; fluo
// keeps excluding Node 22, so every Babel-dependent tooling surface floors at
// the 24.11 compiler floor. Pure runtime packages keep the 24.0 runtime floor.
const RUNTIME_NODE_ENGINE = '>=24.0.0 <27';
const COMPILER_TOOLCHAIN_NODE_ENGINE = '>=24.11.0 <27';
const compilerToolchainPackages = new Set([
  '@fluojs/cli',
  '@fluojs/vite',
  '@fluojs/platform-nextjs',
]);

function requiredNodeEngineRange(manifest: PackageManifest): string {
  if (manifest.private && manifest.name === 'fluo') {
    return COMPILER_TOOLCHAIN_NODE_ENGINE;
  }

  if (compilerToolchainPackages.has(manifest.name)) {
    return COMPILER_TOOLCHAIN_NODE_ENGINE;
  }

  return RUNTIME_NODE_ENGINE;
}

function readPackageManifests(): { root: PackageManifest; packages: PackageManifest[] } {
  const packagesRoot = new URL('../../packages/', import.meta.url);
  const packages: PackageManifest[] = readdirSync(packagesRoot).map((directory) => JSON.parse(
    readFileSync(new URL(`${directory}/package.json`, packagesRoot), 'utf8'),
  ));
  const root: PackageManifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

  return { root, packages };
}

describe('Node support classification', () => {
  it('keeps the nine portable public roots free of engines.node', () => {
    // Given: every public package is classified at its manifest boundary.
    const { packages } = readPackageManifests();
    const publicManifests = packages.filter((manifest) => !manifest.private);

    // When: package managers consume the published Node support claims.
    const omissions = publicManifests.filter((manifest) => manifest.engines?.node === undefined);

    // Then: only the nine portable roots omit engines.
    expect(omissions.map((manifest) => manifest.name).sort()).toEqual(portablePackages);
  });

  it('classifies every engines.node claim into the runtime or compiler toolchain floor', () => {
    // Given: the checked-in root and public package manifests.
    const { root, packages } = readPackageManifests();
    const publicManifests = packages.filter((manifest) => !manifest.private);
    const nodeBound = publicManifests.filter((manifest) => !portablePackages.includes(manifest.name));

    // Then: 35 Node-bound public packages remain, each on its classified floor,
    // and the private root workspace compiles through the Babel 8 toolchain.
    expect(nodeBound).toHaveLength(35);
    for (const manifest of nodeBound) {
      expect(manifest.engines?.node, manifest.name).toBe(requiredNodeEngineRange(manifest));
    }
    expect(root.engines?.node, root.name).toBe(COMPILER_TOOLCHAIN_NODE_ENGINE);
  });

  it('assigns exactly the Babel-dependent tooling packages to the compiler floor', () => {
    // Given: the classified public manifests.
    const { packages } = readPackageManifests();
    const publicManifests = packages.filter((manifest) => !manifest.private);

    // When: the compiler toolchain floor set is evaluated against manifests.
    const compilerClassified = publicManifests.filter((manifest) => manifest.engines?.node === COMPILER_TOOLCHAIN_NODE_ENGINE);

    // Then: only the Babel-dependent tooling packages carry the compiler floor.
    expect(compilerClassified.map((manifest) => manifest.name).sort()).toEqual([...compilerToolchainPackages].sort());
  });

  it('rejects a compiler tooling package that silently returns to the runtime floor', () => {
    // Given: a Babel-dependent tooling manifest claiming the runtime floor.
    const reverted: PackageManifest = {
      name: '@fluojs/vite',
      private: false,
      engines: { node: RUNTIME_NODE_ENGINE },
    };

    // When: the required floor for the Babel 8 compiler toolchain is derived.
    const requiredRange = () => requiredNodeEngineRange(reverted);

    // Then: the classification mismatches, so the manifest fails the contract.
    expect(requiredRange()).not.toBe(reverted.engines?.node);
    expect(requiredRange()).toBe(COMPILER_TOOLCHAIN_NODE_ENGINE);
    expect(reverted.engines?.node).not.toBe(COMPILER_TOOLCHAIN_NODE_ENGINE);
  });

  it('rejects a runtime package that claims the compiler toolchain floor', () => {
    // Given: a Node runtime manifest raised to the compiler floor.
    const overraised: PackageManifest = {
      name: '@fluojs/http',
      private: false,
      engines: { node: COMPILER_TOOLCHAIN_NODE_ENGINE },
    };

    // When: the required floor for the runtime package is derived.
    // Then: the compiler floor does not belong to runtime packages.
    expect(requiredNodeEngineRange(overraised)).toBe(RUNTIME_NODE_ENGINE);
    expect(overraised.engines?.node).not.toBe(requiredNodeEngineRange(overraised));
  });
});
