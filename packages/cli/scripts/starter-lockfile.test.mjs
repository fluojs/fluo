import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureStarterSnapshot, prepareStarterDependencies } from '../../../tooling/cli/starter-lockfile.mjs';
import * as starterLockfile from '../../../tooling/cli/starter-lockfile.mjs';
import { workspacePackageManifests } from '../../../tooling/release/release-intents.mjs';
import { generateStarterSnapshots } from '../../../tooling/cli/generate-starter-snapshots.mjs';

const repositoryRoot = new URL('../../../', import.meta.url);

test('refreshStarterSnapshotVersions: release mutation -> preserves reviewed external locks and validates packed graphs', (t) => {
  // Given: the real reviewed React starter contains importer, override and peer-context references.
  const snapshot = JSON.parse(readFileSync(new URL(
    'tooling/cli/verification-locks/starter-react-vite-ssr.json', repositoryRoot,
  ), 'utf8'));
  const manifests = workspacePackageManifests(repositoryRoot.pathname).map(({ manifest }) => manifest);
  const released = manifests.map((manifest) => ({
    ...manifest,
    version: manifest.name === '@fluojs/react' ? '0.3.99'
      : manifest.name === '@fluojs/cli' ? '4.0.99' : manifest.version,
  }));
  const original = structuredClone(snapshot);
  const root = mkdtempSync(join(tmpdir(), 'fluo-release-snapshot-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  // When
  const updated = starterLockfile.refreshStarterSnapshotVersions(snapshot, released);

  // Then: every packed graph is checked by the unchanged consumer against actual tar archives.
  assert.deepEqual(snapshot, original);
  assert.deepEqual(starterLockfile.refreshStarterSnapshotVersions(updated, released), updated);
  assert.equal(updated.manifest.dependencies['@fluojs/react'], 'file:.fluo-ci/packages/fluojs-react-0.3.99.tgz');
  assert.equal(updated.manifest.devDependencies['@fluojs/cli'], 'file:.fluo-ci/packages/fluojs-cli-4.0.99.tgz');
  for (const section of ['packages', 'snapshots']) {
    const external = (lock) => Object.fromEntries(Object.entries(lock[section])
      .filter(([key]) => !key.includes('file:.fluo-ci/packages/')));
    assert.deepEqual(external(updated.lockfile), external(original.lockfile));
  }
  const project = join(root, 'project');
  mkdirSync(join(project, '.fluo-ci/packages'), { recursive: true });
  writeFileSync(join(project, 'package.json'), JSON.stringify(updated.manifest));
  for (const [reference, internal] of Object.entries(updated.internalGraphs)) {
    const archive = join(root, 'archive');
    const packed = structuredClone(released.find(({ name }) => name === internal.name));
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, range] of Object.entries(packed[section] ?? {})) {
        if (!range.startsWith('workspace:')) continue;
        const version = released.find((manifest) => manifest.name === name)?.version;
        assert.ok(version);
        const suffix = range.slice(10);
        packed[section][name] = suffix === '^' || suffix === '~' ? `${suffix}${version}`
          : suffix === '*' || suffix === '' ? version : suffix;
      }
    }
    mkdirSync(join(archive, 'package'), { recursive: true });
    writeFileSync(join(archive, 'package/package.json'), JSON.stringify(packed));
    const result = spawnSync('tar', ['-czf', join(project, reference.slice(5)), '-C', archive, 'package']);
    assert.equal(result.status, 0, result.stderr?.toString());
  }
  const snapshotPath = join(root, 'snapshot.json');
  writeFileSync(snapshotPath, JSON.stringify(original));
  assert.throws(() => prepareStarterDependencies(project, snapshotPath), /dependency graph/u);
  writeFileSync(snapshotPath, JSON.stringify(updated));
  assert.equal(prepareStarterDependencies(project, snapshotPath).mode, 'locked');
  const frozen = JSON.parse(readFileSync(join(project, 'pnpm-lock.yaml'), 'utf8'));
  assert.equal(frozen.packages['@fluojs/react@file:.fluo-ci/packages/fluojs-react-0.3.99.tgz'].version, '0.3.99');
  assert.ok(Object.keys(frozen.snapshots).some((key) =>
    key.startsWith('@fluojs/cli@file:.fluo-ci/packages/fluojs-cli-4.0.99.tgz(')));
  assert.equal(JSON.stringify(frozen).includes('fluojs-cli-3.0.3.tgz'), false);
  assert.equal(JSON.stringify(frozen).includes('fluojs-react-0.2.2.tgz'), false);
});

for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
  test(`refreshStarterSnapshotVersions: ${section} external spec mutation -> rejects stale resolution`, () => {
    // Given
    const snapshot = JSON.parse(readFileSync(new URL(
      'tooling/cli/verification-locks/starter-react-vite-ssr.json', repositoryRoot,
    ), 'utf8'));
    const manifests = workspacePackageManifests(repositoryRoot.pathname).map(({ manifest }) =>
      manifest.name === '@fluojs/react'
        ? { ...manifest, version: '0.3.99', [section]: { ...manifest[section], external: '^20.0.0' } }
        : manifest);

    // When / Then
    assert.throws(() => starterLockfile.refreshStarterSnapshotVersions(snapshot, manifests), /dependency graph/u);
  });
}

test('generateStarterSnapshots: later graph change -> writes no version corrections', (t) => {
  // Given
  const root = mkdtempSync(join(tmpdir(), 'fluo-release-atomic-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const snapshot = JSON.parse(readFileSync(new URL(
    'tooling/cli/verification-locks/starter-react-vite-ssr.json', repositoryRoot,
  ), 'utf8'));
  for (const { manifest } of workspacePackageManifests(repositoryRoot.pathname)) {
    const directory = join(root, 'packages', manifest.name.slice('@fluojs/'.length));
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'package.json'), JSON.stringify({
      ...manifest, version: manifest.name === '@fluojs/cli' ? '9.0.0' : manifest.version,
    }));
  }
  const directory = join(root, 'tooling/cli/verification-locks');
  mkdirSync(directory, { recursive: true });
  const original = JSON.stringify(snapshot);
  writeFileSync(join(directory, 'a.json'), original);
  const invalid = structuredClone(snapshot);
  const react = Object.values(invalid.internalGraphs).find(({ name }) => name === '@fluojs/react');
  react.peerDependencies.react = '^20.0.0';
  writeFileSync(join(directory, 'z.json'), JSON.stringify(invalid));

  // When / Then
  assert.throws(() => generateStarterSnapshots(root), /dependency graph/u);
  assert.equal(readFileSync(join(directory, 'a.json'), 'utf8'), original);
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'fluo-starter-lock-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'archive/package'), { recursive: true });
  const internal = { name: '@fluojs/core', version: '1.0.0', dependencies: { external: '^1.0.0' } };
  writeFileSync(join(root, 'archive/package/package.json'), JSON.stringify(internal));
  writeFileSync(join(root, 'archive/package/index.js'), 'export const revision = 1;');
  const tarball = join(root, 'fluojs-core-1.0.0.tgz');
  const pack = () => {
    const result = spawnSync('tar', ['-czf', tarball, '-C', join(root, 'archive'), 'package']);
    assert.equal(result.status, 0);
  };
  pack();
  const project = join(root, 'project');
  mkdirSync(project);
  writeFileSync(join(project, 'package.json'), JSON.stringify({
    name: 'starter', dependencies: { '@fluojs/core': `file:${tarball}`, external: '^1.0.0' },
    overrides: { '@fluojs/core': `file:${tarball}` },
    resolutions: { '@fluojs/core': `file:${tarball}` },
    pnpm: { overrides: { '@fluojs/core': `file:${tarball}` } },
  }));
  return { root, project, internal, tarball, pack };
}

test('normalizes every package manager override map before resolution', (t) => {
  // Given
  const f = fixture(t);

  // When
  prepareStarterDependencies(f.project);

  // Then
  const manifest = JSON.parse(readFileSync(join(f.project, 'package.json'), 'utf8'));
  for (const map of [manifest.dependencies, manifest.overrides, manifest.resolutions, manifest.pnpm.overrides]) {
    assert.equal(map['@fluojs/core'], 'file:.fluo-ci/packages/fluojs-core-1.0.0.tgz');
  }
});

test('freezes external resolutions while rebinding only freshly packed internal bytes', (t) => {
  // Given
  const f = fixture(t);
  prepareStarterDependencies(f.project);
  const reference = 'file:.fluo-ci/packages/fluojs-core-1.0.0.tgz';
  const lock = { lockfileVersion: '9.0', packages: {
    [`@fluojs/core@${reference}`]: { resolution: { tarball: reference, integrity: 'old-internal-integrity' } },
    'external@1.0.2': { resolution: { integrity: 'locked-external-integrity' } },
  } };
  const snapshot = captureStarterSnapshot(f.project, lock);
  const path = join(f.root, 'snapshot.json');
  writeFileSync(path, JSON.stringify(snapshot));
  writeFileSync(join(f.root, 'archive/package/index.js'), 'export const revision = 2;');
  f.pack();
  writeFileSync(join(f.project, '.fluo-ci/packages/fluojs-core-1.0.0.tgz'), readFileSync(f.tarball));

  // When
  prepareStarterDependencies(f.project, path);

  // Then
  const frozen = JSON.parse(readFileSync(join(f.project, 'pnpm-lock.yaml'), 'utf8'));
  assert.deepEqual(frozen.packages['external@1.0.2'], lock.packages['external@1.0.2']);
  assert.equal(frozen.packages[`@fluojs/core@${reference}`].resolution.integrity,
    `sha512-${createHash('sha512').update(readFileSync(f.tarball)).digest('base64')}`);
});

test('rejects changed internal dependency graphs rather than reusing stale external resolutions', (t) => {
  // Given
  const f = fixture(t);
  prepareStarterDependencies(f.project);
  const snapshot = captureStarterSnapshot(f.project, { lockfileVersion: '9.0', packages: {} });
  const path = join(f.root, 'snapshot.json');
  writeFileSync(path, JSON.stringify(snapshot));
  writeFileSync(join(f.root, 'archive/package/package.json'), JSON.stringify({
    ...f.internal, dependencies: { external: '^2.0.0' },
  }));
  f.pack();
  writeFileSync(join(f.project, '.fluo-ci/packages/fluojs-core-1.0.0.tgz'), readFileSync(f.tarball));

  // When / Then
  assert.throws(() => prepareStarterDependencies(f.project, path), /dependency graph/u);
});

test('pnpm consumes JSON-form YAML lockfiles in frozen mode', (t) => {
  // Given
  const root = mkdtempSync(join(tmpdir(), 'fluo-json-lock-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'package.json'), '{"name":"frozen-lock-proof","version":"1.0.0","private":true}');
  writeFileSync(join(root, 'pnpm-lock.yaml'), JSON.stringify({
    lockfileVersion: '9.0', settings: { autoInstallPeers: true, excludeLinksFromLockfile: false },
    importers: { '.': {} },
  }));

  // When
  const result = spawnSync('pnpm', ['install', '--frozen-lockfile', '--ignore-scripts'], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
  });

  // Then
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
