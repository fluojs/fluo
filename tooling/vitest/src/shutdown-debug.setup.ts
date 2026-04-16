import process from 'node:process';

import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';

import {
  collectVitestProcessLeakSnapshot,
  isFluoVitestShutdownDebugEnabled,
  writeVitestShutdownDebugSnapshot,
} from './shutdown-debug.js';

type ActivityPhase = 'beforeAll' | 'afterAll' | 'beforeEach' | 'afterEach';

interface WorkerActivity {
  at: string;
  file: string;
  phase: ActivityPhase;
  suite: string | null;
  test: string | null;
}

interface WorkerDebugState {
  listenersInstalled: boolean;
  lastActivity?: WorkerActivity;
}

interface SuiteLike {
  file?: {
    filepath?: string;
  };
  filepath?: string;
  name?: string;
}

interface ContextLike {
  task?: {
    file?: {
      filepath?: string;
    };
    name?: string;
  };
}

const workerDebugStateKey = Symbol.for('fluo.vitest.shutdownDebugState');

function getWorkerDebugState(): WorkerDebugState {
  const globalState = globalThis as typeof globalThis & {
    [workerDebugStateKey]?: WorkerDebugState;
  };

  if (!globalState[workerDebugStateKey]) {
    globalState[workerDebugStateKey] = {
      listenersInstalled: false,
    };
  }

  return globalState[workerDebugStateKey];
}

function normalizeFilePath(filePath: string): string {
  return filePath.startsWith(process.cwd()) ? filePath.slice(process.cwd().length + 1) : filePath;
}

export function resolveWorkerActivitySuiteName(suite: SuiteLike | undefined): string | null {
  const name = suite?.name;
  return typeof name === 'string' && name.length > 0 ? name : null;
}

export function resolveWorkerActivityFilePath(
  source: SuiteLike | ContextLike | undefined,
  fallbackFilePath = '[unknown-file]',
): string {
  const candidate = source as (SuiteLike & ContextLike) | undefined;
  const suiteFilePath = candidate?.filepath;
  const nestedFilePath = candidate?.file?.filepath;
  const taskFilePath = candidate?.task?.file?.filepath;

  const filePath = [suiteFilePath, nestedFilePath, taskFilePath, fallbackFilePath].find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );

  return normalizeFilePath(filePath ?? fallbackFilePath);
}

export function resolveWorkerActivityTestName(context: ContextLike | undefined): string | null {
  const name = context?.task?.name;
  return typeof name === 'string' && name.length > 0 ? name : null;
}

function updateLastActivity(activity: WorkerActivity) {
  getWorkerDebugState().lastActivity = activity;
}

function writeWorkerSignalSnapshot(trigger: 'SIGINT' | 'SIGTERM') {
  const workerState = getWorkerDebugState();
  const filePath = writeVitestShutdownDebugSnapshot(process.cwd(), `worker-${String(process.pid)}-${trigger.toLowerCase()}`, {
    kind: 'worker-signal',
    detectedAt: new Date().toISOString(),
    pid: process.pid,
    trigger,
    lastActivity: workerState.lastActivity,
    process: collectVitestProcessLeakSnapshot(),
  });

  console.error(`[fluo-vitest-shutdown-debug] worker ${String(process.pid)} wrote ${trigger} evidence to ${filePath}`);
}

function installSignalListener(trigger: 'SIGINT' | 'SIGTERM') {
  const listener = () => {
    process.removeListener(trigger, listener);
    writeWorkerSignalSnapshot(trigger);
    process.kill(process.pid, trigger);
  };

  process.on(trigger, listener);
}

function installProcessListeners() {
  const workerState = getWorkerDebugState();
  if (workerState.listenersInstalled || !isFluoVitestShutdownDebugEnabled()) {
    return;
  }

  workerState.listenersInstalled = true;
  installSignalListener('SIGINT');
  installSignalListener('SIGTERM');
}

if (isFluoVitestShutdownDebugEnabled()) {
  installProcessListeners();

  beforeAll((suite) => {
    updateLastActivity({
      at: new Date().toISOString(),
      file: resolveWorkerActivityFilePath(suite),
      phase: 'beforeAll',
      suite: resolveWorkerActivitySuiteName(suite),
      test: null,
    });
  });

  beforeEach((context, suite) => {
    updateLastActivity({
      at: new Date().toISOString(),
      file: resolveWorkerActivityFilePath(context),
      phase: 'beforeEach',
      suite: resolveWorkerActivitySuiteName(suite),
      test: resolveWorkerActivityTestName(context),
    });
  });

  afterEach((context, suite) => {
    updateLastActivity({
      at: new Date().toISOString(),
      file: resolveWorkerActivityFilePath(context),
      phase: 'afterEach',
      suite: resolveWorkerActivitySuiteName(suite),
      test: resolveWorkerActivityTestName(context),
    });
  });

  afterAll((suite) => {
    updateLastActivity({
      at: new Date().toISOString(),
      file: resolveWorkerActivityFilePath(suite),
      phase: 'afterAll',
      suite: resolveWorkerActivitySuiteName(suite),
      test: null,
    });
  });
}
