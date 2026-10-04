import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { assertInstalledLockfile, environmentSummary } from '../src/provenance';

test('rejects installed dependency overrides that differ from the declared lockfile', () => {
  // Given
  const expected = 'lockfileVersion: 9\noverrides:\n  package: 1.0.0\n';
  const installed = 'lockfileVersion: 9\noverrides:\n  package: 2.0.0\n';
  // When / Then
  assert.throws(() => assertInstalledLockfile(expected, installed), /Installed dependency lockfile differs/);
  assert.doesNotThrow(() => assertInstalledLockfile(expected, expected));
});

test('captures installed type-only packages as well as runtime and linked packages', { timeout: 20_000 }, async () => {
  // Given: type-only packages have package.json but no executable entry point.
  // When
  const environment = await environmentSummary();
  // Then: versions are from installed manifests, not dependency range strings.
  for (const name of ['@types/autocannon', '@types/node', 'autocannon', '@fluojs/core']) {
    const installed = environment.dependencies[name];
    const manifest = JSON.parse(await readFile(`${installed.path}/package.json`, 'utf8'));
    assert.equal(installed.version, manifest.version);
  }
  assert.match(environment.git.sha, /^[0-9a-f]{40}$/);
  assert.equal(environment.git.dirty, environment.git.status.length > 0);
  assert.equal(environment.node, process.version);
  assert.match(environment.adapterFastify['@nestjs/platform-fastify'].version, /^5\./);
});
