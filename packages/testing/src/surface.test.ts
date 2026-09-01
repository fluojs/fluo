import { type ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import type { Mock } from 'vitest';
import { describe, expect, it } from 'vitest';
import * as fetchStyleWebsocket from './conformance/fetch-style-websocket-conformance.js';
import * as conformance from './conformance/platform-conformance.js';
import * as platformShellLifecycle from './conformance/platform-shell-lifecycle-conformance.js';
import * as http from './http.js';
import type { DeepMocked as RootDeepMocked } from './index.js';
import * as testing from './index.js';
import type { DeepMocked as MockDeepMocked } from './mock.js';
import * as mock from './mock.js';
import type { NetworkHttpErrorRepresentationBootstrapOptions } from './portability/http-adapter-portability.js';
import * as portability from './portability/http-adapter-portability.js';
import type { WebHttpErrorRepresentationBootstrapOptions } from './portability/web-runtime-adapter-portability.js';
import * as webPortability from './portability/web-runtime-adapter-portability.js';
import type { DeepMocked } from './types.js';
import * as vitestTooling from './vitest/tooling.js';
import * as vitestEntry from './vitest.js';

type Assert<T extends true> = T;
type IsAssignable<From, To> = [From] extends [To] ? true : false;
type TaskkillCommand = (
  file: string,
  args: readonly string[],
  options: { readonly timeout?: number; readonly windowsHide: boolean },
) => Promise<void>;
type NodeProcessStartHook = (child: ChildProcessWithoutNullStreams) => Promise<void>;
type DestroyableStdio = {
  destroy(): unknown;
};

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
type _NetworkErrorRepresentationOptionsArePublic = Assert<
  IsAssignable<
    NetworkHttpErrorRepresentationBootstrapOptions,
    {
      readonly cors: false;
      readonly middleware: readonly unknown[];
      readonly observers: readonly unknown[];
      readonly port: 0;
    }
  >
>;
type _WebErrorRepresentationOptionsArePublic = Assert<
  IsAssignable<
    WebHttpErrorRepresentationBootstrapOptions,
    { readonly cors: false; readonly middleware: readonly unknown[] }
  >
>;

const packageRoot = new URL('..', import.meta.url);
const packageRootPath = fileURLToPath(packageRoot);
const repoRootPath = fileURLToPath(new URL('../../..', import.meta.url));
const packageJsonPath = new URL('../package.json', import.meta.url);
const execFileAsync = promisify(execFile);
const CHILD_PROCESS_TIMEOUT_MS = 240_000;
const PROCESS_TERMINATION_CONFIRM_TIMEOUT_MS = 5_000;
const DESCENDANT_PROCESS_TIMEOUT_MS = 1_000;
const DESCENDANT_TIMEOUT_TEST_BOUNDED_OPERATION_COUNT = 6;
const DESCENDANT_TIMEOUT_TEST_SCHEDULING_MARGIN_MS = 5_000;
const DESCENDANT_TIMEOUT_TEST_TIMEOUT_MS =
  PROCESS_TERMINATION_CONFIRM_TIMEOUT_MS * DESCENDANT_TIMEOUT_TEST_BOUNDED_OPERATION_COUNT +
  DESCENDANT_PROCESS_TIMEOUT_MS +
  DESCENDANT_TIMEOUT_TEST_SCHEDULING_MARGIN_MS;
const emittedHarnessSubpaths = [
  '.',
  './app',
  './module',
  './http',
  './mock',
  './platform-conformance',
  './platform-shell-lifecycle-conformance',
  './http-adapter-portability',
  './web-runtime-adapter-portability',
  './fetch-style-websocket-conformance',
  './types',
  './vitest',
  './vitest/tooling',
] as const;

const executeTaskkillCommand: TaskkillCommand = async (file, args, options) => {
  await execFileAsync(file, [...args], options);
};

async function waitForSignal(signal: Promise<void>, timeoutMs: number, failureMessage: string): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      signal,
      new Promise<never>((_resolvePromise, rejectPromise) => {
        timeout = setTimeout(() => rejectPromise(new Error(failureMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function destroyOwnedStdio(streams: readonly DestroyableStdio[], preservePrimaryError: boolean): void {
  const cleanupErrors: unknown[] = [];

  for (const stream of streams) {
    try {
      stream.destroy();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }

  if (!preservePrimaryError && cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Failed to destroy one or more child process stdio handles.');
  }
}

async function runWindowsTaskkill(pid: number, execute: TaskkillCommand = executeTaskkillCommand): Promise<void> {
  try {
    await execute('taskkill.exe', ['/pid', String(pid), '/t', '/f'], {
      timeout: PROCESS_TERMINATION_CONFIRM_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (error) {
    throw new Error(
      `Unable to terminate Windows child process tree ${pid} within ${PROCESS_TERMINATION_CONFIRM_TIMEOUT_MS}ms using taskkill.exe /T /F.`,
      { cause: error },
    );
  }
}

async function terminateOwnedProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  const pid = child.pid;

  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (process.platform === 'win32') {
    try {
      await runWindowsTaskkill(pid);
    } catch (error) {
      if (child.exitCode === null && child.signalCode === null) {
        throw error;
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
  onStarted?: NodeProcessStartHook,
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

  child.stdout.on('data', onStdout);
  child.stderr.on('data', onStderr);
  child.once('error', onError);
  let hasPrimaryError = false;

  try {
    await onStarted?.(child);
    const timeoutPromise = new Promise<'timeout'>((resolvePromise) => {
      timeout = setTimeout(() => resolvePromise('timeout'), timeoutMs);
    });
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
  } catch (error) {
    hasPrimaryError = true;
    try {
      await terminateOwnedProcessTree(child);
    } catch (terminationError) {
      throw new AggregateError(
        [error, terminationError],
        'Child process failed and fallback process-tree termination could not be confirmed.',
      );
    }
    throw error;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    child.stdout.off('data', onStdout);
    child.stderr.off('data', onStderr);
    child.off('error', onError);
    child.off('close', onClose);
    destroyOwnedStdio([child.stdin, child.stdout, child.stderr], hasPrimaryError);
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
    expect('createPlatformShellLifecycleConformanceHarness' in testing).toBe(false);
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
    expect(platformShellLifecycle.createPlatformShellLifecycleConformanceHarness).toBeTypeOf('function');
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
    expect(packageJson.exports['./platform-shell-lifecycle-conformance']).toEqual({
      types: './dist/conformance/platform-shell-lifecycle-conformance.d.ts',
      import: './dist/conformance/platform-shell-lifecycle-conformance.js',
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

  it('bounds and reports taskkill failures without invoking Windows', async () => {
    const taskkillFailure = new Error('taskkill stalled');
    let observedTimeout: number | undefined;

    await expect(
      runWindowsTaskkill(42, async (_file, _args, options) => {
        observedTimeout = options.timeout;
        throw taskkillFailure;
      }),
    ).rejects.toMatchObject({
      cause: taskkillFailure,
      message: `Unable to terminate Windows child process tree 42 within ${PROCESS_TERMINATION_CONFIRM_TIMEOUT_MS}ms using taskkill.exe /T /F.`,
    });
    expect(observedTimeout).toBe(PROCESS_TERMINATION_CONFIRM_TIMEOUT_MS);
  });

  it('destroys every owned stdio handle without replacing a primary child failure', () => {
    const destroyed: string[] = [];

    expect(() =>
      destroyOwnedStdio(
        [
          {
            destroy() {
              destroyed.push('stdin');
              throw new Error('stdin cleanup failed');
            },
          },
          {
            destroy() {
              destroyed.push('stdout');
            },
          },
          {
            destroy() {
              destroyed.push('stderr');
            },
          },
        ],
        true,
      ),
    ).not.toThrow();
    expect(destroyed).toEqual(['stdin', 'stdout', 'stderr']);
  });

  it('terminates descendant processes before reporting a child timeout', async () => {
    let resolveDescendantReady: () => void = () => {};
    let rejectDescendantReady: (error: Error) => void = () => {};
    const descendantReadySignal = new Promise<void>((resolvePromise, rejectPromise) => {
      resolveDescendantReady = resolvePromise;
      rejectDescendantReady = rejectPromise;
    });
    let resolveDescendantExit: () => void = () => {};
    let rejectDescendantExit: (error: Error) => void = () => {};
    const descendantExitSignal = new Promise<void>((resolvePromise, rejectPromise) => {
      resolveDescendantExit = resolvePromise;
      rejectDescendantExit = rejectPromise;
    });
    const descendantExitServer = createServer((socket) => {
      let readinessMessage = '';

      socket.once('error', rejectDescendantReady);
      const onReadinessData = (message: Buffer): void => {
        readinessMessage += message.toString();

        if (!'ready\n'.startsWith(readinessMessage)) {
          rejectDescendantReady(new Error(`Unexpected descendant readiness message: ${readinessMessage}`));
          socket.destroy();
          return;
        }

        if (readinessMessage === 'rea') {
          socket.write('con');
          return;
        }

        if (readinessMessage !== 'ready\n') {
          return;
        }

        socket.off('data', onReadinessData);
        socket.off('error', rejectDescendantReady);
        socket.once('error', rejectDescendantExit);
        socket.once('close', resolveDescendantExit);
        socket.write('tinue\n');
        resolveDescendantReady();
      };
      socket.on('data', onReadinessData);
    });
    descendantExitServer.once('error', rejectDescendantReady);
    let readinessObservedBeforeTimeout = false;
    let spawnedParent: ChildProcessWithoutNullStreams | undefined;
    let primaryError: unknown;

    try {
      const listeningSignal = once(descendantExitServer, 'listening').then(() => undefined);
      descendantExitServer.listen(0, '127.0.0.1');
      await waitForSignal(
        listeningSignal,
        PROCESS_TERMINATION_CONFIRM_TIMEOUT_MS,
        'Descendant readiness server did not start listening on loopback TCP.',
      );
      const address = descendantExitServer.address();

      if (address === null || typeof address === 'string') {
        throw new Error('Descendant readiness server did not bind to a loopback TCP port.');
      }

      const descendantScript = `
        const { connect } = await import('node:net');
        const socket = connect({ host: '127.0.0.1', port: ${address.port} });
        let controlMessage = '';
        const onControlData = (message) => {
          controlMessage += message.toString();

          if (!'continue\\n'.startsWith(controlMessage)) {
            process.exitCode = 1;
            socket.destroy();
            return;
          }

          if (controlMessage === 'con') {
            socket.write('dy\\n');
            return;
          }

          if (controlMessage === 'continue\\n') {
            socket.off('data', onControlData);
          }
        };
        socket.once('connect', () => socket.write('rea'));
        socket.on('data', onControlData);
        socket.on('error', () => process.exitCode = 1);
        setInterval(() => {}, 1_000);
      `;
      const parentScript = `
        const { spawn } = await import('node:child_process');
        spawn(process.execPath, ['--eval', ${JSON.stringify(descendantScript)}], {
          stdio: ['ignore', 'inherit', 'inherit'],
        });
        setInterval(() => {}, 1_000);
      `;

      await expect(
        runNodeProcess(
          ['--input-type=module', '--eval', parentScript],
          packageRootPath,
          DESCENDANT_PROCESS_TIMEOUT_MS,
          async (child) => {
            spawnedParent = child;
            await waitForSignal(
              descendantReadySignal,
              PROCESS_TERMINATION_CONFIRM_TIMEOUT_MS,
              'Descendant did not complete its loopback TCP readiness handshake.',
            );
            readinessObservedBeforeTimeout = true;
          },
        ),
      ).rejects.toThrow('Child process timed out after 1000ms');
      expect(readinessObservedBeforeTimeout).toBe(true);
      await waitForSignal(
        descendantExitSignal,
        PROCESS_TERMINATION_CONFIRM_TIMEOUT_MS,
        'Descendant did not close its loopback TCP connection after process-tree termination.',
      );
    } catch (error) {
      primaryError = error;
    }

    const cleanupErrors: unknown[] = [];

    if (spawnedParent !== undefined) {
      try {
        await terminateOwnedProcessTree(spawnedParent);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (descendantExitServer.listening) {
      try {
        await waitForSignal(
          new Promise<void>((resolvePromise, rejectPromise) => {
            descendantExitServer.close((error) => {
              if (error === undefined) {
                resolvePromise();
                return;
              }

              rejectPromise(error);
            });
          }),
          PROCESS_TERMINATION_CONFIRM_TIMEOUT_MS,
          'Descendant readiness server did not close after process-tree termination.',
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (primaryError !== undefined) {
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [primaryError, ...cleanupErrors],
          'Descendant timeout regression test and fallback cleanup both failed.',
        );
      }

      throw primaryError;
    }

    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Descendant timeout regression test cleanup failed.');
    }
  }, DESCENDANT_TIMEOUT_TEST_TIMEOUT_MS);

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
    expect(readFileSync(resolve(packageRootPath, 'dist/portability/http-adapter-portability.d.ts'), 'utf8'))
      .toContain('NetworkHttpErrorRepresentationBootstrapOptions');
    expect(readFileSync(resolve(packageRootPath, 'dist/portability/web-runtime-adapter-portability.d.ts'), 'utf8'))
      .toContain('WebHttpErrorRepresentationBootstrapOptions');
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
