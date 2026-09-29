import assert from 'node:assert/strict';
import test from 'node:test';
import { executeVerificationTasks, verificationConcurrency } from './verification-scheduler.mjs';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('independent tasks overlap and downstream starts only after successful evidence', { timeout: 5_000 }, async () => {
  const first = deferred();
  const second = deferred();
  const started = deferred();
  const downstream = deferred();
  const seen = [];
  const execution = executeVerificationTasks([
    { id: 'first', dependencies: [] },
    { id: 'second', dependencies: [] },
    { id: 'dependent', dependencies: ['first'] },
  ], 2, (task) => {
    seen.push(task.id);
    if (seen.length === 2) started.resolve();
    if (task.id === 'first') return first.promise;
    if (task.id === 'second') return second.promise;
    downstream.resolve();
  });
  await started.promise;
  assert.deepEqual(seen, ['first', 'second']);
  second.resolve();
  // The dependent cannot be admitted until first settles successfully.
  await second.promise;
  assert.deepEqual(seen, ['first', 'second']);
  first.resolve();
  await downstream.promise;
  assert.deepEqual(seen, ['first', 'second', 'dependent']);
  await execution;
});

test('failure stops admission and waits for every in-flight task before rejecting', { timeout: 5_000 }, async () => {
  const failed = deferred();
  const inFlight = deferred();
  const started = deferred();
  const seen = [];
  const execution = executeVerificationTasks([
    { id: 'failed', dependencies: [] },
    { id: 'in-flight', dependencies: [] },
    { id: 'downstream', dependencies: ['failed'] },
    { id: 'other', dependencies: [] },
  ], 2, (task) => {
    seen.push(task.id);
    if (seen.length === 2) started.resolve();
    return task.id === 'failed' ? failed.promise : inFlight.promise;
  });
  let settled = false;
  const outcome = execution.then(
    () => { settled = true; },
    (error) => { settled = true; return error; },
  );
  await started.promise;
  failed.reject(new Error('task log says broken'));
  await failed.promise.catch(() => {});
  assert.equal(settled, false);
  assert.deepEqual(seen, ['failed', 'in-flight']);
  inFlight.resolve();
  const error = await outcome;
  assert.match(error.message, /failed: task log says broken/u);
  assert.equal(settled, true);
  assert.deepEqual(seen, ['failed', 'in-flight']);
});

test('rejects invalid concurrency and unresolved dependencies', async () => {
  for (const value of ['0', '-1', '2.5', 'abc', '', '9007199254740992']) {
    assert.throws(() => verificationConcurrency(value, 16), /positive integer/u);
  }
  assert.equal(verificationConcurrency('8', 3), 3);
  await assert.rejects(executeVerificationTasks([{ id: 'orphan', dependencies: ['missing'] }], 2, () => {}),
    /unresolved dependencies/u);
  await assert.rejects(executeVerificationTasks([], 0, () => {}), /positive integer/u);
});

test('default concurrency respects the Docker backend memory rather than host memory', () => {
  // Given: A twelve-core host exposes only eight GiB to its Docker backend.
  const resources = { cpus: 12, memoryBytes: 8 * 1024 ** 3 };
  // When / Then: Capacity follows the executor, not the coordinator machine.
  assert.equal(verificationConcurrency(undefined, 16, resources), 4);
  assert.equal(verificationConcurrency(undefined, 16, { cpus: 2, memoryBytes: 16 * 1024 ** 3 }), 1);
});
