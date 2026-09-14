import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('./verify-local.mjs', import.meta.url);

test('prints a machine-readable exact-head plan without creating a receipt', () => {
  const result = spawnSync(process.execPath, [script.pathname, '--plan', '--base-ref', 'HEAD~0'], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(typeof plan.identity.headSha, 'string');
  assert.equal(plan.commands[0].id, 'install');
});

test('rejects unknown verifier options', () => {
  const result = spawnSync(process.execPath, [script.pathname, '--unknown'], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown option/u);
});
