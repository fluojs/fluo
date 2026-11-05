import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  readonly name: string;
  readonly private: boolean;
  readonly engines?: { readonly node?: string };
  readonly dependencies?: Readonly<Record<string, string>>;
}

const portablePackages = [
  '@fluojs/auth',
  '@fluojs/cache-manager',
  '@fluojs/config',
  '@fluojs/core',
  '@fluojs/cqrs',
  '@fluojs/cron',
  '@fluojs/di',
  '@fluojs/diagnostics',
  '@fluojs/discord',
  '@fluojs/drizzle',
  '@fluojs/email',
  '@fluojs/event-bus',
  '@fluojs/http',
  '@fluojs/i18n',
  '@fluojs/notifications',
  '@fluojs/openapi',
  '@fluojs/persistence',
  '@fluojs/platform-bun',
  '@fluojs/platform-cloudflare-workers',
  '@fluojs/react',
  '@fluojs/runtime',
  '@fluojs/serialization',
  '@fluojs/slack',
  '@fluojs/socket.io',
  '@fluojs/terminus',
  '@fluojs/throttler',
  '@fluojs/validation',
  '@fluojs/websockets',
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
  // Retired platform directories (the platform-deno archive) keep only
  // README/CHANGELOG files and publish no manifest that needs classification.
  const packages: PackageManifest[] = readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(new URL(`${entry.name}/package.json`, packagesRoot)))
    .map((entry) => JSON.parse(
      readFileSync(new URL(`${entry.name}/package.json`, packagesRoot), 'utf8'),
    ));
  const root: PackageManifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

  return { root, packages };
}

describe('Node support classification', () => {
  it('keeps mandatory first-party dependencies of multi-runtime roots free of Node installation gates', () => {
    // Given: published runtime-neutral and native-host roots and their actual manifests.
    const { packages } = readPackageManifests();
    const manifests = new Map(packages.map((manifest) => [manifest.name, manifest]));
    const pending = portablePackages.map((name) => [name]);
    const visited = new Set<string>();
    const violations: string[] = [];

    // When: following mandatory production dependencies, without opting into optional peers.
    for (const path of pending) {
      const name = path[path.length - 1];
      if (name === undefined || visited.has(name)) {
        continue;
      }
      visited.add(name);
      const manifest = manifests.get(name);
      if (manifest === undefined) {
        throw new Error(`Missing first-party manifest: ${path.join(' -> ')}`);
      }
      if (manifest.engines?.node !== undefined) {
        violations.push(`${path.join(' -> ')}: ${manifest.engines.node}`);
      }
      for (const dependency of Object.keys(manifest.dependencies ?? {})) {
        if (dependency.startsWith('@fluojs/')) {
          pending.push([...path, dependency]);
        }
      }
    }

    // Then: a native adapter cannot reintroduce a Node gate through a shared dependency.
    expect(violations).toEqual([]);
  });

  it('keeps multi-runtime public packages free of engines.node', () => {
    // Given: every public package is classified at its manifest boundary.
    const { packages } = readPackageManifests();
    const publicManifests = packages.filter((manifest) => !manifest.private);

    // When: package managers consume the published Node support claims.
    const omissions = publicManifests.filter((manifest) => manifest.engines?.node === undefined);

    // Then: shared roots and mixed-host packages do not impose Node installation gates.
    expect(omissions.map((manifest) => manifest.name).sort()).toEqual(portablePackages);
  });

  it('classifies every engines.node claim into the runtime or compiler toolchain floor', () => {
    // Given: the checked-in root and public package manifests.
    const { root, packages } = readPackageManifests();
    const publicManifests = packages.filter((manifest) => !manifest.private);
    const nodeBound = publicManifests.filter((manifest) => !portablePackages.includes(manifest.name));

    // Then: 18 Node-bound public packages, including auth-http, use their classified floor,
    // and the private root workspace compiles through the Babel 8 toolchain.
    expect(nodeBound).toHaveLength(18);
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
      name: '@fluojs/platform-nodejs',
      private: false,
      engines: { node: COMPILER_TOOLCHAIN_NODE_ENGINE },
    };

    // When: the required floor for the runtime package is derived.
    // Then: the compiler floor does not belong to runtime packages.
    expect(requiredNodeEngineRange(overraised)).toBe(RUNTIME_NODE_ENGINE);
    expect(overraised.engines?.node).not.toBe(requiredNodeEngineRange(overraised));
  });
});
