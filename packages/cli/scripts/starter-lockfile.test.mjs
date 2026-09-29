import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureStarterSnapshot, prepareStarterDependencies } from '../../../tooling/cli/starter-lockfile.mjs';

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
