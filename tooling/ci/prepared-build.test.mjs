import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { recordPreparedBuild, verifyPreparedBuild } from './prepared-build.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'fluo-prepared-build-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'packages/sample/dist'), { recursive: true });
  writeFileSync(join(root, '.gitignore'), 'dist/\n.omo/\n');
  writeFileSync(join(root, 'packages/sample/package.json'),
    JSON.stringify({ name: '@fluojs/sample', scripts: { build: 'build-sample' } }));
  writeFileSync(join(root, 'packages/sample/source.ts'), 'export const value = 1;\n');
  writeFileSync(join(root, 'packages/sample/dist/index.js'), 'export const value = 1;\n');
  for (const args of [['init', '-q'], ['add', '.'],
    ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture']]) {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  }
  return root;
}

test('standalone preparation does not accept unverified dist', (t) => {
  // Given: Emitted output exists without runner provenance.
  const root = fixture(t);
  // When / Then: Normal test preparation must still run.
  assert.equal(verifyPreparedBuild(root, undefined), false);
});

test('reuses a recorded build only while its source and complete output inventory match', (t) => {
  // Given: A runner records output after a successful build or validated restore.
  const root = fixture(t);
  const path = recordPreparedBuild(root, 'sha256:fixture-image');
  // When / Then: Exact output is reusable; stale bytes are not.
  assert.equal(verifyPreparedBuild(root, path), true);
  writeFileSync(join(root, 'packages/sample/dist/index.js'), 'tampered');
  assert.throws(() => verifyPreparedBuild(root, path), /prepared build/u);
});

test('missing output and changed source fail closed', (t) => {
  // Given: Recorded build output is complete.
  const root = fixture(t);
  const path = recordPreparedBuild(root, 'sha256:fixture-image');
  // When / Then: Source changes invalidate reuse even if dist remains.
  writeFileSync(join(root, 'packages/sample/source.ts'), 'export const value = 2;\n');
  assert.throws(() => verifyPreparedBuild(root, path), /prepared build/u);
});

test('missing package output cannot be recorded as a complete build', (t) => {
  // Given: A buildable package has lost its emitted directory.
  const root = fixture(t);
  rmSync(join(root, 'packages/sample/dist'), { recursive: true });
  // When / Then: Recording cannot certify a partial producer.
  assert.throws(() => recordPreparedBuild(root, 'sha256:fixture-image'), /output/u);
});

test('real global setup preserves standalone builds and rejects stale reused artifacts', (t) => {
  // Given: The production setup runs against a fixture with an observable closure builder.
  const root = fixture(t);
  mkdirSync(join(root, 'tooling/vitest/src'), { recursive: true });
  mkdirSync(join(root, 'tooling/ci'), { recursive: true });
  mkdirSync(join(root, 'tooling/scripts'), { recursive: true });
  copyFileSync(new URL('../vitest/src/packages-global-setup.ts', import.meta.url),
    join(root, 'tooling/vitest/src/setup.mjs'));
  copyFileSync(new URL('./prepared-build.mjs', import.meta.url), join(root, 'tooling/ci/prepared-build.mjs'));
  writeFileSync(join(root, 'tooling/scripts/run-workspace-build-closure.mjs'),
    'import { appendFileSync, mkdirSync } from "node:fs"; mkdirSync(".omo", {recursive:true}); appendFileSync(".omo/builds", process.argv[2]+"\\n");');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'setup'], { cwd: root });
  const args = ['--input-type=module', '-e', 'import setup from "./tooling/vitest/src/setup.mjs"; setup();'];
  execFileSync(process.execPath, args, { cwd: root, env: { ...process.env, FLUO_VERIFIED_BUILD: '' } });
  assert.equal(readFileSync(join(root, '.omo/builds'), 'utf8'), '@fluojs/terminus\n@fluojs/prisma\n');
  const path = recordPreparedBuild(root, 'sha256:fixture-image');

  // When: The same setup consumes a validated output inventory.
  execFileSync(process.execPath, args, { cwd: root, env: { ...process.env, FLUO_VERIFIED_BUILD: path } });

  // Then: Preparation is not repeated, but missing emitted bytes fail rather than silently skip.
  assert.equal(readFileSync(join(root, '.omo/builds'), 'utf8'), '@fluojs/terminus\n@fluojs/prisma\n');
  rmSync(join(root, 'packages/sample/dist/index.js'));
  assert.throws(() => execFileSync(process.execPath, args, {
    cwd: root, env: { ...process.env, FLUO_VERIFIED_BUILD: path }, stdio: 'pipe',
  }), /prepared build output/u);
});
