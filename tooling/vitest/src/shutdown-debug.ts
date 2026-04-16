import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import process from 'node:process';

import type { TestCase, TestModule, TestSuite } from 'vitest/node';
import type { Reporter } from 'vitest/reporters';

export const FLUO_VITEST_SHUTDOWN_DEBUG_ENV = 'FLUO_VITEST_SHUTDOWN_DEBUG';
export const FLUO_VITEST_SHUTDOWN_DEBUG_DIR_ENV = 'FLUO_VITEST_SHUTDOWN_DEBUG_DIR';

declare global {
  namespace NodeJS {
    interface Process {
      _getActiveHandles?(): unknown[];
      _getActiveRequests?(): unknown[];
    }
  }
}

type PrimitiveDetail = boolean | number | string | null;

interface ResourceSample {
  constructorName: string;
  details?: Record<string, PrimitiveDetail>;
}

interface ResourceSummary {
  count: number;
  types: Array<{
    constructorName: string;
    count: number;
    samples: ResourceSample[];
  }>;
}

interface TestModuleSnapshot {
  moduleId: string;
  projectName: string | null;
  state: string;
  ok: boolean;
  diagnostic: ReturnType<TestModule['diagnostic']>;
}

interface TestSuiteSnapshot {
  moduleId: string;
  projectName: string | null;
  fullName: string;
  state: string;
}

interface TestCaseSnapshot {
  moduleId: string;
  projectName: string | null;
  fullName: string;
  state: string;
  diagnostic: ReturnType<TestCase['diagnostic']>;
}

function getEnvValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function toRelativePath(repoRoot: string, value: string): string {
  if (!value.startsWith(repoRoot)) {
    return value;
  }

  const relativePath = relative(repoRoot, value);
  return relativePath.length > 0 ? relativePath : '.';
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    value: String(error),
  };
}

function extractPrimitiveDetail(value: unknown): PrimitiveDetail | undefined {
  if (value === null) {
    return null;
  }

  switch (typeof value) {
    case 'boolean':
    case 'number':
    case 'string':
      return value;
    default:
      return undefined;
  }
}

function summarizeResource(resource: unknown): ResourceSample {
  const candidate = resource as {
    address?: () => { address?: string; family?: string; port?: number };
    bytesRead?: number;
    bytesWritten?: number;
    connected?: boolean;
    destroyed?: boolean;
    fd?: number;
    hasRef?: () => boolean;
    localAddress?: string;
    localPort?: number;
    path?: string;
    pending?: boolean;
    readable?: boolean;
    readyState?: string;
    remoteAddress?: string;
    remotePort?: number;
    writable?: boolean;
  };

  const constructorName =
    typeof resource === 'object' && resource !== null && 'constructor' in resource
      ? ((resource.constructor as { name?: string }).name ?? 'Unknown')
      : typeof resource;

  const details: Record<string, PrimitiveDetail> = {};
  const knownDetails: Record<string, unknown> = {
    bytesRead: candidate.bytesRead,
    bytesWritten: candidate.bytesWritten,
    connected: candidate.connected,
    destroyed: candidate.destroyed,
    fd: candidate.fd,
    hasRef: candidate.hasRef?.(),
    localAddress: candidate.localAddress,
    localPort: candidate.localPort,
    path: candidate.path,
    pending: candidate.pending,
    readable: candidate.readable,
    readyState: candidate.readyState,
    remoteAddress: candidate.remoteAddress,
    remotePort: candidate.remotePort,
    writable: candidate.writable,
  };

  const serverAddress = candidate.address?.();
  if (serverAddress) {
    knownDetails.boundAddress = serverAddress.address;
    knownDetails.boundFamily = serverAddress.family;
    knownDetails.boundPort = serverAddress.port;
  }

  for (const [key, value] of Object.entries(knownDetails)) {
    const primitive = extractPrimitiveDetail(value);
    if (primitive !== undefined) {
      details[key] = primitive;
    }
  }

  return {
    constructorName,
    details: Object.keys(details).length > 0 ? details : undefined,
  };
}

function collectResourceSummary(resources: readonly unknown[]): ResourceSummary {
  const types = new Map<string, { count: number; samples: ResourceSample[] }>();

  for (const resource of resources) {
    const sample = summarizeResource(resource);
    const existing = types.get(sample.constructorName) ?? {
      count: 0,
      samples: [],
    };

    existing.count += 1;
    if (existing.samples.length < 3) {
      existing.samples.push(sample);
    }

    types.set(sample.constructorName, existing);
  }

  return {
    count: resources.length,
    types: [...types.entries()]
      .map(([constructorName, entry]) => ({
        constructorName,
        count: entry.count,
        samples: entry.samples,
      }))
      .sort((left, right) => right.count - left.count || left.constructorName.localeCompare(right.constructorName)),
  };
}

export function isFluoVitestShutdownDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = getEnvValue(env, FLUO_VITEST_SHUTDOWN_DEBUG_ENV);
  return value === '1' || value === 'true';
}

export function resolveFluoVitestShutdownDebugDirectory(
  repoRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return getEnvValue(env, FLUO_VITEST_SHUTDOWN_DEBUG_DIR_ENV) ?? join(repoRoot, '.artifacts', 'vitest-shutdown-debug');
}

export function collectVitestProcessLeakSnapshot(): {
  activeHandles: ResourceSummary;
  activeRequests: ResourceSummary;
} {
  return {
    activeHandles: collectResourceSummary(process._getActiveHandles?.() ?? []),
    activeRequests: collectResourceSummary(process._getActiveRequests?.() ?? []),
  };
}

export function writeVitestShutdownDebugSnapshot(
  repoRoot: string,
  fileName: string,
  payload: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const directory = resolveFluoVitestShutdownDebugDirectory(repoRoot, env);
  mkdirSync(directory, { recursive: true });

  const filePath = join(directory, `${fileName}.json`);
  writeFileSync(
    filePath,
    JSON.stringify(
      {
        schemaVersion: 1,
        ...payload,
      },
      null,
      2,
    ),
  );

  return filePath;
}

function createTestModuleSnapshot(testModule: TestModule, repoRoot: string): TestModuleSnapshot {
  return {
    moduleId: toRelativePath(repoRoot, testModule.moduleId),
    projectName: testModule.project.name ?? null,
    state: testModule.state(),
    ok: testModule.ok(),
    diagnostic: testModule.diagnostic(),
  };
}

function createTestSuiteSnapshot(testSuite: TestSuite, repoRoot: string): TestSuiteSnapshot {
  return {
    moduleId: toRelativePath(repoRoot, testSuite.module.moduleId),
    projectName: testSuite.project.name ?? null,
    fullName: testSuite.fullName,
    state: testSuite.state(),
  };
}

function createTestCaseSnapshot(testCase: TestCase, repoRoot: string): TestCaseSnapshot {
  return {
    moduleId: toRelativePath(repoRoot, testCase.module.moduleId),
    projectName: testCase.project.name ?? null,
    fullName: testCase.fullName,
    state: testCase.result().state,
    diagnostic: testCase.diagnostic(),
  };
}

function formatUnhandledErrors(errors: ReadonlyArray<unknown>): Record<string, unknown>[] {
  return errors.map((error) => serializeError(error));
}

class FluoVitestShutdownDebugReporter implements Reporter {
  private readonly activeModules = new Map<string, TestModuleSnapshot>();

  private lastRunStartedAt?: string;
  private lastModuleStart?: TestModuleSnapshot;
  private lastModuleEnd?: TestModuleSnapshot;
  private lastSuiteReady?: TestSuiteSnapshot;
  private lastSuiteResult?: TestSuiteSnapshot;
  private lastTestReady?: TestCaseSnapshot;
  private lastTestResult?: TestCaseSnapshot;

  constructor(private readonly repoRoot: string) {}

  onTestRunStart() {
    this.lastRunStartedAt = new Date().toISOString();
  }

  onTestModuleStart(testModule: TestModule) {
    const snapshot = createTestModuleSnapshot(testModule, this.repoRoot);
    this.activeModules.set(snapshot.moduleId, snapshot);
    this.lastModuleStart = snapshot;
  }

  onTestModuleEnd(testModule: TestModule) {
    const snapshot = createTestModuleSnapshot(testModule, this.repoRoot);
    this.activeModules.delete(snapshot.moduleId);
    this.lastModuleEnd = snapshot;
  }

  onTestSuiteReady(testSuite: TestSuite) {
    this.lastSuiteReady = createTestSuiteSnapshot(testSuite, this.repoRoot);
  }

  onTestSuiteResult(testSuite: TestSuite) {
    this.lastSuiteResult = createTestSuiteSnapshot(testSuite, this.repoRoot);
  }

  onTestCaseReady(testCase: TestCase) {
    this.lastTestReady = createTestCaseSnapshot(testCase, this.repoRoot);
  }

  onTestCaseResult(testCase: TestCase) {
    this.lastTestResult = createTestCaseSnapshot(testCase, this.repoRoot);
  }

  onProcessTimeout() {
    const snapshot = {
      kind: 'main-process-timeout',
      detectedAt: new Date().toISOString(),
      runStartedAt: this.lastRunStartedAt,
      activeModules: [...this.activeModules.values()],
      lastModuleStart: this.lastModuleStart,
      lastModuleEnd: this.lastModuleEnd,
      lastSuiteReady: this.lastSuiteReady,
      lastSuiteResult: this.lastSuiteResult,
      lastTestReady: this.lastTestReady,
      lastTestResult: this.lastTestResult,
      process: collectVitestProcessLeakSnapshot(),
    };

    const filePath = writeVitestShutdownDebugSnapshot(this.repoRoot, 'main-process-timeout', snapshot);
    const handleSummary = snapshot.process.activeHandles.types
      .map((entry) => `${entry.constructorName}×${String(entry.count)}`)
      .join(', ');

    console.error(`[fluo-vitest-shutdown-debug] wrote timeout evidence to ${filePath}`);
    if (this.lastTestReady) {
      console.error(`[fluo-vitest-shutdown-debug] last ready test: ${this.lastTestReady.fullName}`);
    }
    if (handleSummary.length > 0) {
      console.error(`[fluo-vitest-shutdown-debug] active handles: ${handleSummary}`);
    }
  }

  onTestRunEnd(testModules: ReadonlyArray<TestModule>, unhandledErrors: ReadonlyArray<unknown>, reason: string) {
    if (reason === 'passed' && unhandledErrors.length === 0) {
      return;
    }

    const filePath = writeVitestShutdownDebugSnapshot(this.repoRoot, 'run-end', {
      kind: 'run-end',
      finishedAt: new Date().toISOString(),
      runStartedAt: this.lastRunStartedAt,
      reason,
      testModules: testModules.map((testModule) => createTestModuleSnapshot(testModule, this.repoRoot)),
      unhandledErrors: formatUnhandledErrors(unhandledErrors),
      process: collectVitestProcessLeakSnapshot(),
    });

    console.error(`[fluo-vitest-shutdown-debug] wrote run-end evidence to ${filePath}`);
  }
}

export function createFluoVitestShutdownDebugReporter(repoRoot: string): Reporter {
  return new FluoVitestShutdownDebugReporter(repoRoot);
}
