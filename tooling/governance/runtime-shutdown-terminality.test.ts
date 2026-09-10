import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { InvariantError } from '../../packages/core/src/index.js';
import { defineModule, FluoFactory } from '../../packages/runtime/src/bootstrap.js';

const repoRoot = join(import.meta.dirname, '../..');

function read(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf8');
}

function createDeferred(): { readonly promise: Promise<void>; resolve(): void } {
  let resolve: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });

  return { promise, resolve: () => resolve() };
}

const lifecycleOwners = [
  'docs/architecture/lifecycle-and-shutdown.md',
  'docs/architecture/lifecycle-and-shutdown.ko.md',
] as const;
const contractStart = '<!-- fluo:lifecycle-shutdown:start -->';
const contractEnd = '<!-- fluo:lifecycle-shutdown:end -->';
const expectedContract = {
  schemaVersion: 1,
  states: ['bootstrapped', 'ready', 'closed'],
  admissionCloses: 'close-start',
  blockedOperations: [
    'Application.get()',
    'ApplicationContext.get()',
    'Application.listen()',
    'Application.dispatch()',
    'Application.connectMicroservice()',
    'Application.startAllMicroservices()',
  ],
  stateDuringCloseOrFailure: 'unchanged',
  closedAfter: 'successful-runtime-teardown',
  signalCleanupFailureState: 'closed-after-runtime-teardown',
  admittedDispatch: 'not-cancelled-by-gate',
  shutdownOrder: [
    'readiness-reset',
    'runtime-cleanup',
    'onModuleDestroy:reverse',
    'onApplicationShutdown:reverse',
    'adapter.close',
    'container.dispose',
  ],
  retry: {
    runtimeCleanup: 'incomplete-phase-all-registrations',
    lifecycleHooks: 'incomplete-phase-all-hooks',
    adapter: 'adapter-owned',
    container: 'failed-onDestroy-only',
    microservice: 'cached-terminal-result',
    admissionReopens: false,
  },
  nodeSignals: {
    defaults: ['SIGINT', 'SIGTERM'],
    forceExitTimeoutMs: 30_000,
    callsProcessExit: false,
  },
  nodeAdapterShutdownTimeoutMs: 10_000,
  httpCreation: {
    entrypoint: 'FluoFactory.create',
    removedExports: ['bootstrapApplication', 'fluoFactory'],
    middleware: ['cors:opt-in', 'prefix:opt-in', 'security-headers:default-on', 'caller', 'module:after-match'],
    logger: 'option-or-portable-console',
    creationFailure: 'original-error-after-adapter-and-runtime-cleanup',
    listenFailure: 'terminal-shutdown',
    shutdownRegistration: 'host-owned-opt-in-after-listen',
    unregistration: 'attempt-once-retain-failure',
  },
};

function readLifecycleContract(content: string): unknown {
  const parts = content.split(contractStart);
  const endings = parts[1]?.split(contractEnd);
  const block = endings?.[0]?.trim();

  if (parts.length !== 2 || endings?.length !== 2 || !block?.startsWith('```json\n') || !block.endsWith('\n```')) {
    throw new Error('Expected one lifecycle contract JSON sentinel block.');
  }

  return JSON.parse(block.slice('```json\n'.length, -'\n```'.length));
}

function expectLifecycleContract(content: string): void {
  expect(readLifecycleContract(content)).toEqual(expectedContract);
}

function contractDocument(value: unknown): string {
  return `${contractStart}\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\`\n${contractEnd}`;
}

describe('lifecycle Docs contract ownership', () => {
  it.each(lifecycleOwners)('requires machine-consumed lifecycle fields in %s', (relativePath) => {
    expectLifecycleContract(read(relativePath));
  });

  it('ignores surrounding navigation and explanatory prose', () => {
    expectLifecycleContract(`# Reworded introduction\n\n${contractDocument(expectedContract)}\n\nChanged explanation.`);
  });

  it.each([
    '',
    contractDocument(expectedContract).replace(contractStart, ''),
    contractDocument(expectedContract).replace(contractEnd, ''),
    contractDocument(expectedContract).repeat(2),
    contractDocument(expectedContract).replace('"schemaVersion":1', '"schemaVersion":'),
  ])('rejects missing, duplicate, or malformed owner sentinels (%#)', (content) => {
    expect(() => expectLifecycleContract(content)).toThrow();
  });

  it.each([
    ...Object.keys(expectedContract).map((key) =>
      Object.fromEntries(Object.entries(expectedContract).filter(([field]) => field !== key))),
    { ...expectedContract, states: ['bootstrapped', 'ready', 'closing', 'closed'] },
    { ...expectedContract, admissionCloses: 'container-disposal' },
    ...expectedContract.blockedOperations.map((operation) => ({
      ...expectedContract,
      blockedOperations: expectedContract.blockedOperations.filter((candidate) => candidate !== operation),
    })),
    { ...expectedContract, stateDuringCloseOrFailure: 'closed' },
    { ...expectedContract, closedAfter: 'close-start' },
    { ...expectedContract, admittedDispatch: 'cancelled' },
    { ...expectedContract, shutdownOrder: [...expectedContract.shutdownOrder].reverse() },
    ...Object.keys(expectedContract.retry).map((key) => ({
      ...expectedContract,
      retry: { ...expectedContract.retry, [key]: 'all-work-restarts' },
    })),
    { ...expectedContract, retry: { ...expectedContract.retry, admissionReopens: true } },
    { ...expectedContract, nodeSignals: { ...expectedContract.nodeSignals, defaults: ['SIGTERM'] } },
    { ...expectedContract, nodeSignals: { ...expectedContract.nodeSignals, callsProcessExit: true } },
    { ...expectedContract, nodeSignals: { ...expectedContract.nodeSignals, forceExitTimeoutMs: 10_000 } },
    { ...expectedContract, nodeAdapterShutdownTimeoutMs: 30_000 },
    ...Object.keys(expectedContract.httpCreation).map((key) => ({
      ...expectedContract,
      httpCreation: { ...expectedContract.httpCreation, [key]: 'changed' },
    })),
  ])('rejects lifecycle contract loss or mutation (%#)', (contract) => {
    expect(() => expectLifecycleContract(contractDocument(contract))).toThrow();
  });

  it.each(lifecycleOwners)('compares %s states with real terminal shutdown and failed DI retry', async (relativePath) => {
    // Given: a real runtime/DI application with a controlled adapter-close boundary.
    const releaseClose = createDeferred();
    const closeStarted = createDeferred();
    const failure = new Error('owned disposal failed');
    let adapterCloses = 0;
    let failingDisposals = 0;
    let successfulDisposals = 0;
    let shutdownHooks = 0;
    class FailingResource {
      onDestroy() {
        failingDisposals += 1;
        if (failingDisposals === 1) {
          throw failure;
        }
      }
      onApplicationShutdown() {
        shutdownHooks += 1;
      }
    }
    class SuccessfulResource {
      onDestroy() {
        successfulDisposals += 1;
      }
    }
    class RootModule {}
    defineModule(RootModule, { providers: [FailingResource, SuccessfulResource] });
    const app = await FluoFactory.create(RootModule, {
      adapter: {
        async listen() {},
        async close() {
          adapterCloses += 1;
          closeStarted.resolve();
          await releaseClose.promise;
        },
      },
    });
    const states = [app.state];

    // When: shutdown is pending and then fails in container-owned disposal.
    await app.listen();
    states.push(app.state);
    const closing = app.close('SIGTERM');
    const concurrent = app.close('SIGTERM');
    const results = Promise.allSettled([closing, concurrent]);
    try {
      await closeStarted.promise;
      expect(app.state).toBe('ready');
      await expect(app.get(FailingResource)).rejects.toBeInstanceOf(InvariantError);
      await expect(app.listen()).rejects.toBeInstanceOf(InvariantError);
      await expect(app.connectMicroservice()).rejects.toBeInstanceOf(InvariantError);
      await expect(app.startAllMicroservices()).rejects.toBeInstanceOf(InvariantError);
    } finally {
      releaseClose.resolve();
      await results;
    }

    // Then: failure is shared, use stays terminal, and retry owns failed disposal only.
    expect(await results).toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ]);
    expect(app.state).toBe('ready');
    await expect(app.get(FailingResource)).rejects.toBeInstanceOf(InvariantError);
    await expect(app.listen()).rejects.toBeInstanceOf(InvariantError);
    await app.close();
    states.push(app.state);
    await app.close();
    await expect(app.get(FailingResource)).rejects.toThrow();
    expect({ adapterCloses, failingDisposals, successfulDisposals, shutdownHooks }).toEqual({
      adapterCloses: 1,
      failingDisposals: 2,
      successfulDisposals: 1,
      shutdownHooks: 1,
    });
    expect(readLifecycleContract(read(relativePath))).toMatchObject({ states });
  });

  it('replays an incomplete context hook phase without replaying successful DI disposal', async () => {
    // Given: a context hook that fails only its first shutdown attempt.
    const events: string[] = [];
    const failure = new Error('context shutdown failed');
    let attempts = 0;
    class Resource {
      onModuleDestroy() { events.push('module:destroy'); }
      onApplicationShutdown() {
        events.push('application:shutdown');
        attempts += 1;
        if (attempts === 1) {
          throw failure;
        }
      }
      onDestroy() { events.push('container:dispose'); }
    }
    class RootModule {}
    defineModule(RootModule, { providers: [Resource] });
    const context = await FluoFactory.createApplicationContext(RootModule);

    // When: the hook phase fails but container disposal succeeds.
    await expect(context.close()).rejects.toBe(failure);

    // Then: provider lookup stays terminal and retry replays both hook passes only.
    await expect(context.get(Resource)).rejects.toBeInstanceOf(InvariantError);
    await context.close();
    await context.close();
    expect(events).toEqual([
      'module:destroy', 'application:shutdown', 'container:dispose',
      'module:destroy', 'application:shutdown',
    ]);
  });
});

function sourceExample(content: string, sourceMarker: string): string {
  const sourceStart = content.indexOf(sourceMarker);
  const fence = '```typescript\n';
  const fenceStart = content.indexOf(fence, sourceStart);
  const codeStart = fenceStart + fence.length;
  const codeEnd = content.indexOf('\n```', codeStart);

  if (sourceStart < 0 || fenceStart < 0 || codeEnd < 0) {
    throw new Error(`Missing governed source example for ${sourceMarker}.`);
  }

  return content.slice(codeStart, codeEnd);
}

function sourceRange(sourceMarker: string): [number, number] {
  const match = /bootstrap\.ts:(\d+)-(\d+)/u.exec(sourceMarker);

  if (!match) {
    throw new Error(`Missing source range in ${sourceMarker}.`);
  }

  return [Number(match[1]), Number(match[2])];
}

function expectSourceExampleToMatchRuntime(
  content: string,
  runtimeSource: string,
  sourceMarker: string,
): void {
  const [start, end] = sourceRange(sourceMarker);
  const expected = runtimeSource.split('\n').slice(start - 1, end).join('\n');

  expect(sourceExample(content, sourceMarker)).toBe(expected);
}

describe('legacy Book runtime source consumers', () => {
  it.each([
    'book/advanced/ch09-app-context.md',
    'book/advanced/ch09-app-context.ko.md',
  ])('keeps Chapter 9 runtime source excerpts byte-aligned with bootstrap.ts in %s', (relativePath) => {
    const content = read(relativePath);
    const runtimeSource = read('packages/runtime/src/bootstrap.ts');
    const contextMarker = 'path:packages/runtime/src/bootstrap.ts:913-947';
    const listenMarker = 'path:packages/runtime/src/bootstrap.ts:755-829';
    const readyMarker = 'path:packages/runtime/src/bootstrap.ts:668-674';
    const dispatcherMarker = 'path:packages/runtime/src/bootstrap.ts:1606-1626';
    const contextGet = sourceExample(content, contextMarker);
    const applicationListen = sourceExample(content, listenMarker);

    expectSourceExampleToMatchRuntime(content, runtimeSource, contextMarker);
    expectSourceExampleToMatchRuntime(content, runtimeSource, listenMarker);
    expectSourceExampleToMatchRuntime(content, runtimeSource, readyMarker);
    expectSourceExampleToMatchRuntime(content, runtimeSource, dispatcherMarker);

    expect(contextGet).toContain('private closeStarted = false;');
    expect(contextGet).toContain(
      'private readonly runtimeShutdownState = createRetryableShutdownState<RuntimeShutdownPhase>();',
    );
    expect(contextGet.match(/this\.assertProviderResolutionAllowed\(\);/gu)).toHaveLength(2);
    expect(contextGet).not.toContain('return resolveContextToken(');
    expect(applicationListen).toContain('if (this.closeStarted)');
    expect(applicationListen).toContain('this.listenPromise = Promise.resolve().then(() => this.startListening());');
    expect(applicationListen).toContain('Application startup was interrupted by shutdown.');
    expect(applicationListen).not.toContain("if (this.applicationState === 'closed')");
  });

  it.each([
    'book/advanced/ch09-app-context.md',
    'book/advanced/ch09-app-context.ko.md',
  ])('rejects a changed source excerpt without governing narrative in %s', (relativePath) => {
    const content = read(relativePath);
    const marker = 'path:packages/runtime/src/bootstrap.ts:913-947';
    const excerpt = sourceExample(content, marker);
    const changed = content.replace(excerpt, `${excerpt}\n// source drift`);

    expect(changed).not.toBe(content);
    expect(() => expectSourceExampleToMatchRuntime(
      changed, read('packages/runtime/src/bootstrap.ts'), marker,
    )).toThrow();
  });
});
