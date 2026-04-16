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
    const filePath = 'filepath' in suite ? suite.filepath : suite.file.filepath;
    updateLastActivity({
      at: new Date().toISOString(),
      file: normalizeFilePath(filePath),
      phase: 'beforeAll',
      suite: suite.name.length > 0 ? suite.name : null,
      test: null,
    });
  });

  beforeEach((context, suite) => {
    updateLastActivity({
      at: new Date().toISOString(),
      file: normalizeFilePath(context.task.file.filepath),
      phase: 'beforeEach',
      suite: suite.name.length > 0 ? suite.name : null,
      test: context.task.name,
    });
  });

  afterEach((context, suite) => {
    updateLastActivity({
      at: new Date().toISOString(),
      file: normalizeFilePath(context.task.file.filepath),
      phase: 'afterEach',
      suite: suite.name.length > 0 ? suite.name : null,
      test: context.task.name,
    });
  });

  afterAll((suite) => {
    const filePath = 'filepath' in suite ? suite.filepath : suite.file.filepath;
    updateLastActivity({
      at: new Date().toISOString(),
      file: normalizeFilePath(filePath),
      phase: 'afterAll',
      suite: suite.name.length > 0 ? suite.name : null,
      test: null,
    });
  });
}
