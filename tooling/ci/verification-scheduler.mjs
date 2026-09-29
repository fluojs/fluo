export function verificationConcurrency(value, taskCount, resources) {
  if (value !== undefined) {
    if (!/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new TypeError('verification concurrency must be a positive integer');
    }
    return Math.min(Number(value), taskCount);
  }
  if (!Number.isSafeInteger(resources?.cpus) || resources.cpus < 1
    || !Number.isSafeInteger(resources?.memoryBytes) || resources.memoryBytes < 1) {
    throw new TypeError('verification requires Docker CPU and memory capacity');
  }
  // Each task has an isolated Docker workspace and may run its own test worker.
  return Math.min(taskCount, Math.max(1, Math.floor(resources.cpus / 2)),
    Math.max(1, Math.floor(resources.memoryBytes / (2 * 1024 ** 3))));
}

export async function executeVerificationTasks(tasks, concurrency, execute) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new TypeError('verification concurrency must be a positive integer');
  }
  const completed = new Set();
  const running = new Map();
  const finished = [];
  let notify;
  let failure = null;
  while (completed.size < tasks.length && !failure) {
    for (const task of tasks) {
      if (running.size >= concurrency) break;
      if (completed.has(task.id) || running.has(task.id)
        || !task.dependencies.every((id) => completed.has(id))) continue;
      // Defer the execution to the next microtask so a synchronous throw is
      // handled exactly like a rejected child process.
      const pending = Promise.resolve().then(() => execute(task));
      const work = pending.then(
        () => ({ taskId: task.id }),
        (error) => ({ taskId: task.id, error }),
      );
      running.set(task.id, work);
      work.then((result) => {
        finished.push(result);
        notify?.();
      });
    }
    if (!running.size) {
      failure = new Error('verification tasks have unresolved dependencies');
      break;
    }
    if (!finished.length) await new Promise((resolve) => { notify = resolve; });
    notify = null;
    for (const settled of finished.splice(0)) {
      running.delete(settled.taskId);
      if (settled.error !== undefined) {
        failure ??= new Error(`${settled.taskId}: ${settled.error instanceof Error ? settled.error.message : String(settled.error)}`);
      } else {
        completed.add(settled.taskId);
      }
    }
  }
  // All started subprocesses must finish before aggregation or receipt writing.
  const remaining = await Promise.all(running.values());
  for (const settled of remaining) {
    if (settled.error !== undefined) {
      failure ??= new Error(`${settled.taskId}: ${settled.error instanceof Error ? settled.error.message : String(settled.error)}`);
    }
  }
  if (failure) throw failure;
}
