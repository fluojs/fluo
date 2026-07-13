import { type ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { Mock } from 'vitest';
import { describe, expect, it } from 'vitest';
import * as fetchStyleWebsocket from './conformance/fetch-style-websocket-conformance.js';
import * as conformance from './conformance/platform-conformance.js';
import * as http from './http.js';
import type { DeepMocked as RootDeepMocked } from './index.js';
import * as testing from './index.js';
import type { DeepMocked as MockDeepMocked } from './mock.js';
import * as mock from './mock.js';
import * as portability from './portability/http-adapter-portability.js';
import * as webPortability from './portability/web-runtime-adapter-portability.js';
import type { DeepMocked } from './types.js';
import * as vitestTooling from './vitest/tooling.js';
import * as vitestEntry from './vitest.js';

type Assert<T extends true> = T;
type IsAssignable<From, To> = [From] extends [To] ? true : false;

interface LegacyDeepMockedConsumerService {
  findById(id: string): Promise<{ id: string }>;
  count(): number;
  readonly name: string;
}

type _DeepMockedAsyncMethodPreservesVitestMockCompatibility = Assert<
  IsAssignable<DeepMocked<LegacyDeepMockedConsumerService>['findById'], Mock<(id: string) => Promise<{ id: string }>>>
>;
type _DeepMockedSyncMethodPreservesVitestMockCompatibility = Assert<
  IsAssignable<DeepMocked<LegacyDeepMockedConsumerService>['count'], Mock<() => number>>
>;
type _DeepMockedPropertiesRemainUnchanged = Assert<
  IsAssignable<DeepMocked<LegacyDeepMockedConsumerService>['name'], string>
>;
type _DeepMockedMockContextPreservesCallTuples = Assert<
  IsAssignable<DeepMocked<LegacyDeepMockedConsumerService>['findById']['mock']['calls'], [id: string][]>
>;
type _RootDeepMockedPreservesVitestMockCompatibility = Assert<
  IsAssignable<RootDeepMocked<LegacyDeepMockedConsumerService>['findById'], Mock<(id: string) => Promise<{ id: string }>>>
>;
type _MockDeepMockedPreservesVitestMockCompatibility = Assert<
  IsAssignable<MockDeepMocked<LegacyDeepMockedConsumerService>['findById'], Mock<(id: string) => Promise<{ id: string }>>>
>;

const packageRoot = new URL('..', import.meta.url);
const packageRootPath = fileURLToPath(packageRoot);
const repoRootPath = fileURLToPath(new URL('../../..', import.meta.url));
const packageJsonPath = new URL('../package.json', import.meta.url);
const execFileAsync = promisify(execFile);
const CHILD_PROCESS_TIMEOUT_MS = 240_000;
const PROCESS_TERMINATION_CONFIRM_TIMEOUT_MS = 5_000;
const PROCESS_EXIT_POLL_MS = 20;
const PROCESS_EXIT_TEST_TIMEOUT_MS = 500;
const emittedHarnessSubpaths = [
  '.',
  './app',
  './module',
  './http',
  './mock',
  './platform-conformance',
  './http-adapter-portability',
  './web-runtime-adapter-portability',
  './fetch-style-websocket-conformance',
  './types',
  './vitest',
  './vitest/tooling',
] as const;

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      return false;
    }

    throw error;
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true;
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, PROCESS_EXIT_POLL_MS));
  }

  return !isProcessAlive(pid);
}

async function terminateOwnedProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  const pid = child.pid;

  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    try {
      await execFileAsync('taskkill.exe', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) {
        throw new Error(`Unable to terminate child process tree ${pid} with taskkill.exe.`, { cause: error });
      }
    }
    return;
  }

  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) {
      throw new Error(`Unable to terminate child process group ${pid}.`, { cause: error });
    }
  }
}

async function runNodeProcess(
  args: readonly string[],
  cwd: string,
  timeoutMs: number = CHILD_PROCESS_TIMEOUT_MS,
): Promise<void> {
  const child = spawn(process.execPath, [...args], {
    cwd,
    detached: process.platform !== 'win32',
    env: process.env,
    stdio: 'pipe',
  });
  let spawnError: Error | undefined;
  let stderr = '';
  let stdout = '';

  const onStdout = (chunk: Buffer | string): void => {
    stdout += String(chunk);
  };
  const onStderr = (chunk: Buffer | string): void => {
    stderr += String(chunk);
  };
  const onError = (error: Error): void => {
    spawnError = error;
  };
  let onClose: (code: number | null, signal: NodeJS.Signals | null) => void = () => {};
  const closePromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolvePromise) => {
    onClose = (code, signal): void => {
      resolvePromise({ code, signal });
    };
    child.once('close', onClose);
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<'timeout'>((resolvePromise) => {
    timeout = setTimeout(() => resolvePromise('timeout'), timeoutMs);
  });

  child.stdout.on('data', onStdout);
  child.stderr.on('data', onStderr);
  child.once('error', onError);

  try {
    const outcome = await Promise.race([closePromise, timeoutPromise]);

    if (outcome === 'timeout') {
      const timeoutError = new Error(`Child process timed out after ${timeoutMs}ms: ${args.join(' ')}`);
      let confirmationTimeout: ReturnType<typeof setTimeout> | undefined;

      try {
        await terminateOwnedProcessTree(child);
        await Promise.race([
          closePromise,
          new Promise<never>((_resolvePromise, reject) => {
            confirmationTimeout = setTimeout(() => {
              reject(new Error(`Child process ${String(child.pid)} did not close after process-tree termination.`));
            }, PROCESS_TERMINATION_CONFIRM_TIMEOUT_MS);
          }),
        ]);
      } catch (error) {
        throw new AggregateError(
          [timeoutError, error],
          'Child process timed out and owned process-tree termination could not be confirmed.',
        );
      } finally {
        if (confirmationTimeout !== undefined) {
          clearTimeout(confirmationTimeout);
        }
      }

      throw timeoutError;
    }

    if (spawnError) {
      throw spawnError;
    }

    if (outcome.code !== 0 || outcome.signal !== null) {
      throw new Error([stdout, stderr, outcome.signal ? `signal: ${outcome.signal}` : ''].filter(Boolean).join('\n'));
    }
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    child.stdout.off('data', onStdout);
    child.stderr.off('data', onStderr);
    child.off('error', onError);
    child.off('close', onClose);
  }
}

async function runBuild(): Promise<void> {
  const scriptPath = fileURLToPath(new URL('../../../tooling/scripts/run-workspace-build-closure.mjs', import.meta.url));

  await runNodeProcess([scriptPath, '@fluojs/testing'], repoRootPath);
}

describe('@fluojs/testing surface', () => {
  it('keeps the root barrel focused on module/app helpers', () => {
    expect(testing.createTestingModule).toBeTypeOf('function');
    expect(testing.createTestApp).toBeTypeOf('function');
    expect(testing.extractModuleProviders).toBeTypeOf('function');
    expect('createMock' in testing).toBe(false);
    expect('makeRequest' in testing).toBe(false);
    expect('createPlatformConformanceHarness' in testing).toBe(false);
    expect('createHttpAdapterPortabilityHarness' in testing).toBe(false);
    expect('createWebRuntimeHttpAdapterPortabilityHarness' in testing).toBe(false);
    expect('createFetchStyleWebSocketConformanceHarness' in testing).toBe(false);
  });

  it('exposes responsibility-specific helpers from subpaths', () => {
    expect(mock.createMock).toBeTypeOf('function');
    expect(mock.createDeepMock).toBeTypeOf('function');
    expect(mock.mockToken).toBeTypeOf('function');
    expect(http.makeRequest).toBeTypeOf('function');
    expect(conformance.createPlatformConformanceHarness).toBeTypeOf('function');
    expect(portability.createHttpAdapterPortabilityHarness).toBeTypeOf('function');
    expect(webPortability.createWebRuntimeHttpAdapterPortabilityHarness).toBeTypeOf('function');
    expect(fetchStyleWebsocket.createFetchStyleWebSocketConformanceHarness).toBeTypeOf('function');
    expect(vitestEntry.fluoBabelDecoratorsPlugin).toBeTypeOf('function');
    expect(vitestTooling.collectWorkspaceAliases).toBeTypeOf('function');
    expect(vitestTooling.createFluoVitestWorkspaceConfig).toBeTypeOf('function');
    expect(vitestTooling.defineFluoVitestConfig).toBeTypeOf('function');
  });

  it('keeps published subpath metadata aligned with the built surface', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      exports: Record<string, { import: string; types: string }>;
      peerDependencies: Record<string, string>;
      peerDependenciesMeta?: Record<string, unknown>;
    };

    expect(packageJson.exports['./platform-conformance']).toEqual({
      types: './dist/conformance/platform-conformance.d.ts',
      import: './dist/conformance/platform-conformance.js',
    });
    expect(packageJson.exports['./http-adapter-portability']).toEqual({
      types: './dist/portability/http-adapter-portability.d.ts',
      import: './dist/portability/http-adapter-portability.js',
    });
    expect(packageJson.exports['./web-runtime-adapter-portability']).toEqual({
      types: './dist/portability/web-runtime-adapter-portability.d.ts',
      import: './dist/portability/web-runtime-adapter-portability.js',
    });
    expect(packageJson.exports['./fetch-style-websocket-conformance']).toEqual({
      types: './dist/conformance/fetch-style-websocket-conformance.d.ts',
      import: './dist/conformance/fetch-style-websocket-conformance.js',
    });
    expect(packageJson.exports['./vitest']).toEqual({
      types: './dist/vitest.d.ts',
      import: './dist/vitest.js',
    });
    expect(packageJson.exports['./vitest/tooling']).toEqual({
      types: './dist/vitest/tooling.d.ts',
      import: './dist/vitest/tooling.js',
    });
    expect(packageJson.peerDependencies['@babel/core']).toBe('>=7.0.0');
    expect(packageJson.peerDependencies.vitest).toBe('^3.0.8');
    expect(packageJson.peerDependenciesMeta?.['@babel/core']).toBeUndefined();
    expect(readFileSync(resolve(packageRootPath, 'README.md'), 'utf8')).toContain('pnpm add -D @babel/core');
    expect(readFileSync(resolve(packageRootPath, 'README.ko.md'), 'utf8')).toContain('pnpm add -D @babel/core');
  });

  it('documents the testing module identity contract in both README mirrors', () => {
    const englishReadme = readFileSync(resolve(packageRootPath, 'README.md'), 'utf8');
    const koreanReadme = readFileSync(resolve(packageRootPath, 'README.ko.md'), 'utf8');

    expect(englishReadme).toContain('`createTestingModule({ rootModule })` requires an explicit root module');
    expect(englishReadme).toContain('preserves the original `rootModule` and compiled `modules[].type` identities');
    expect(koreanReadme).toContain('`createTestingModule({ rootModule })`에는 명시적인 루트 모듈이 필요합니다');
    expect(koreanReadme).toContain('원래 `rootModule`과 컴파일된 `modules[].type` identity를 보존합니다');
  });

  it('documents createTestApp bootstrap option and middleware preservation in both README mirrors', () => {
    const englishReadme = readFileSync(resolve(packageRootPath, 'README.md'), 'utf8');
    const koreanReadme = readFileSync(resolve(packageRootPath, 'README.ko.md'), 'utf8');

    expect(englishReadme).toContain('accepts the same application bootstrap options as the runtime HTTP bootstrap');
    expect(englishReadme).toContain('preserving caller-provided middleware');
    expect(koreanReadme).toContain('runtime HTTP bootstrap과 같은 application bootstrap option을 받습니다');
    expect(koreanReadme).toContain('호출자가 넘긴 middleware를 같은 app middleware chain 안에 보존합니다');
  });

  it('documents the Test namespace facade and deduplicated subpath list in both README mirrors', () => {
    const englishReadme = readFileSync(resolve(packageRootPath, 'README.md'), 'utf8');
    const koreanReadme = readFileSync(resolve(packageRootPath, 'README.ko.md'), 'utf8');

    expect(englishReadme).toContain('`Test.createTestingModule(...)`');
    expect(koreanReadme).toContain('`Test.createTestingModule(...)`');
    expect(englishReadme).not.toContain('**Mock subpath**');
    expect(englishReadme).not.toContain('**HTTP helpers**');
    expect(koreanReadme).not.toContain('**Mock 서브패스**');
    expect(koreanReadme).not.toContain('**HTTP 헬퍼**');
  });

  it('terminates descendant processes before reporting a child timeout', async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'fluo-testing-process-tree-'));
    const descendantPidFile = join(fixtureRoot, 'descendant.pid');
    const descendantScript = 'setInterval(() => {}, 1_000);';
    const parentScript = `
      const { spawn } = await import('node:child_process');
      const { writeFileSync } = await import('node:fs');
      const descendant = spawn(process.execPath, ['--eval', ${JSON.stringify(descendantScript)}], {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      writeFileSync(${JSON.stringify(descendantPidFile)}, String(descendant.pid));
      setInterval(() => {}, 1_000);
    `;
    let descendantPid: number | undefined;

    try {
      await expect(
        runNodeProcess(['--input-type=module', '--eval', parentScript], packageRootPath, 1_000),
      ).rejects.toThrow('Child process timed out after 1000ms');

      descendantPid = Number(readFileSync(descendantPidFile, 'utf8'));
      expect(await waitForProcessExit(descendantPid, PROCESS_EXIT_TEST_TIMEOUT_MS)).toBe(true);
    } finally {
      if (descendantPid !== undefined && isProcessAlive(descendantPid)) {
        process.kill(descendantPid, 'SIGKILL');
      }
      rmSync(fixtureRoot, { force: true, recursive: true });
    }
  }, 5_000);

  it('build emits the published harness subpath files without blocking the Vitest worker event loop', async () => {
    await runBuild();

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      exports: Record<string, { import: string; types: string }>;
    };

    for (const subpath of emittedHarnessSubpaths) {
      const entry = packageJson.exports[subpath];

      expect(existsSync(resolve(packageRootPath, entry.import)), `${subpath} import output is missing`).toBe(true);
      expect(existsSync(resolve(packageRootPath, entry.types)), `${subpath} types output is missing`).toBe(true);
    }

    for (const declarationFile of ['dist/app.d.ts', 'dist/module.d.ts', 'dist/types.d.ts']) {
      expect(readFileSync(resolve(packageRootPath, declarationFile), 'utf8')).not.toContain('vitest');
    }

    expect(readFileSync(resolve(packageRootPath, 'dist/types.d.ts'), 'utf8')).toContain('type DeepMocked<T>');
    expect(readFileSync(resolve(packageRootPath, 'dist/mock.d.ts'), 'utf8')).toContain('./mock-types.js');
    expect(readFileSync(resolve(packageRootPath, 'dist/index.d.ts'), 'utf8')).not.toContain('TestingMockFunction');
  }, 300_000);

  it('imports every public package subpath through the published export map', async () => {
    await runBuild();

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      exports: Record<string, { import: string; types: string }>;
    };
    const publicSubpaths = Object.keys(packageJson.exports);
    const nodeSafeSubpaths = publicSubpaths.filter((subpath) => subpath !== './mock');
    const importScript = `
      const subpaths = ${JSON.stringify(nodeSafeSubpaths)};
      await Promise.all(subpaths.map((subpath) => import(subpath === '.' ? '@fluojs/testing' : '@fluojs/testing/' + subpath.slice(2))));
    `;

    await runNodeProcess(['--input-type=module', '--eval', importScript], packageRootPath);

    const mockSubpath = '@fluojs/testing/mock' as string;
    await expect(import(mockSubpath)).resolves.toBeTypeOf('object');
  }, 300_000);
});
