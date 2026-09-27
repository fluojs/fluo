import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RUNTIME_FLOOR_PLAN } from './node-runtime-floor.mjs';

const execFileAsync = promisify(execFile);
const runnerPath = fileURLToPath(new URL('./node-runtime-floor.mjs', import.meta.url));

async function runFixture(t, source) {
  const directory = await mkdtemp(join(tmpdir(), 'fluo-runtime-floor-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixture = join(directory, 'exercise.mjs');
  await writeFile(fixture, source);
  return execFileAsync(process.execPath, [runnerPath, fixture, '--self-test'], { encoding: 'utf8' });
}

test('rejects a runtime exercise that provides no behavioral evidence', async (t) => {
  await assert.rejects(
    runFixture(t, 'export async function runRuntimeFloorExercises() { return []; }'),
    (error) => {
      assert.equal(error.code, 1);
      assert.equal(JSON.parse(error.stdout).passed, false);
      return true;
    },
  );
});

test('rejects compiler imports while executing the runtime exercise', async (t) => {
  const babelUrl = pathToFileURL(createRequire(import.meta.url).resolve('@babel/core')).href;
  const results = RUNTIME_FLOOR_PLAN.behaviors.map((name) => ({ name, passed: true }));
  await assert.rejects(
    runFixture(t, `import ${JSON.stringify(babelUrl)};\nexport async function runRuntimeFloorExercises() { return ${JSON.stringify(results)}; }`),
    (error) => {
      assert.equal(error.code, 1);
      assert.match(error.stderr, /ERR_RUNTIME_FLOOR_COMPILER_IMPORT/u);
      return true;
    },
  );
});

test('declares the exact runtime floor plan for the runtime-only lane', () => {
  assert.equal(RUNTIME_FLOOR_PLAN.runtimeNodeVersion, '24.0.0');
  assert.deepEqual([...RUNTIME_FLOOR_PLAN.publicEntryImports].sort(), [
    '@fluojs/config',
    '@fluojs/core/metadata-preload',
    '@fluojs/http',
    '@fluojs/platform-nodejs',
    '@fluojs/runtime',
  ]);
  assert.deepEqual([...RUNTIME_FLOOR_PLAN.behaviors].sort(), [
    'config-in-memory-load',
    'graceful-application-close',
    'http-listener-greeting-dispatch',
    'http-listener-health-readiness',
  ]);
});

test('refuses the exact-version gate on a Node version other than 24.0.0', async () => {
  const currentVersion = process.versions.node;

  await assert.rejects(
    execFileAsync(process.execPath, [runnerPath, '/nonexistent/runtime-floor-exercise.mjs'], { encoding: 'utf8' }),
    (error) => {
      assert.equal(error.code, 1);
      const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
      assert.match(output, /24\.0\.0/u);
      assert.match(output, new RegExp(currentVersion.replaceAll('.', '\\.'), 'u'));
      return true;
    },
  );
});
