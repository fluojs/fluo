import { Container } from '@fluojs/di';
import {
  createFetchStyleHttpAdapterRealtimeCapability,
  type Dispatcher,
  type HttpApplicationAdapter,
} from '@fluojs/http';
import type { ApplicationLogger } from '@fluojs/runtime';
import { WebSocketGateway } from '@fluojs/websockets';
import { Server } from 'socket.io';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SocketIoLifecycleService } from './adapter.js';
import type { SocketIoModuleOptions } from './types.js';

class TestBunBindingError extends Error {
  readonly name = 'TestBunBindingError';
}

class TestBunAdapter implements HttpApplicationAdapter {
  private binding: unknown | undefined;
  private bindingAttemptCount = 0;
  private bindingClearCount = 0;

  constructor(
    private readonly retainFailedBinding = false,
    private failNextBinding = true,
  ) {}

  get attempts(): number {
    return this.bindingAttemptCount;
  }

  get clears(): number {
    return this.bindingClearCount;
  }

  get currentBinding(): unknown | undefined {
    return this.binding;
  }

  close(): void {}

  getServer(): undefined {
    return undefined;
  }

  setRealtimeBinding(binding: unknown | undefined): void {
    if (binding === undefined) {
      if (this.binding !== undefined) {
        this.bindingClearCount += 1;
      }
      this.binding = undefined;
      return;
    }

    this.bindingAttemptCount += 1;

    if (this.failNextBinding) {
      this.failNextBinding = false;
      if (this.retainFailedBinding) {
        this.binding = binding;
      }
      throw new TestBunBindingError('Bun binding failed.');
    }

    if (this.binding !== undefined) {
      throw new TestBunBindingError('A stale Bun binding blocked retry.');
    }

    this.binding = binding;
  }

  getRealtimeCapability() {
    return createFetchStyleHttpAdapterRealtimeCapability(
      'Test adapter supports Bun-style Socket.IO binding.',
      {
        bindingInstallation: {
          install: (binding) => this.setRealtimeBinding(binding),
        },
        support: 'supported',
      },
    );
  }

  listen(_dispatcher: Dispatcher): void {}
}

const silentLogger: ApplicationLogger = {
  debug() {},
  error() {},
  log() {},
  warn() {},
};

function createLifecycleService(
  adapter: TestBunAdapter,
  options: SocketIoModuleOptions = {},
  logger: ApplicationLogger = silentLogger,
): SocketIoLifecycleService {
  return new SocketIoLifecycleService(new Container(), [], logger, adapter, options);
}

function gateInitialization(service: SocketIoLifecycleService): {
  getCapturedServer(): Server | undefined;
  initializationStarted: Promise<void>;
  releaseInitialization(): void;
} {
  const installBinding = service['installBunSocketIoBinding'].bind(service);
  let capturedServer: Server | undefined;
  let markInitializationStarted = (): void => undefined;
  let releaseInitialization = (): void => undefined;
  const initializationStarted = new Promise<void>((resolve) => {
    markInitializationStarted = resolve;
  });
  const initializationGate = new Promise<void>((resolve) => {
    releaseInitialization = resolve;
  });

  service['installBunSocketIoBinding'] = async (runtime, io) => {
    capturedServer = io;
    markInitializationStarted();
    await initializationGate;
    await installBinding(runtime, io);
  };

  return {
    getCapturedServer: () => capturedServer,
    initializationStarted,
    releaseInitialization,
  };
}

describe('SocketIoLifecycleService Bun initialization', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shares a Bun binding failure with concurrent server callers', async () => {
    // Given
    const adapter = new TestBunAdapter();
    const service = createLifecycleService(adapter);

    // When
    const results = await Promise.allSettled([
      service.getServerAsync(),
      service.getServerAsync(),
    ]);

    // Then
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(adapter.attempts).toBe(1);
  });

  it('cleans a partial Bun binding before retrying server initialization', async () => {
    // Given
    const adapter = new TestBunAdapter(true);
    const service = createLifecycleService(adapter);
    await expect(service.getServerAsync()).rejects.toThrow(TestBunBindingError);

    // When
    const server = await service.getServerAsync();

    // Then
    expect(server).toBeInstanceOf(Server);
    expect(adapter.attempts).toBe(2);
    expect(adapter.clears).toBe(1);
  });

  it('clears a Bun server initialized while application shutdown is in progress', async () => {
    // Given
    const adapter = new TestBunAdapter(false, false);
    const service = createLifecycleService(adapter);
    const installBinding = service['installBunSocketIoBinding'].bind(service);
    let markInitializationStarted = (): void => undefined;
    let releaseInitialization = (): void => undefined;
    const initializationStarted = new Promise<void>((resolve) => {
      markInitializationStarted = resolve;
    });
    const initializationGate = new Promise<void>((resolve) => {
      releaseInitialization = resolve;
    });
    service['installBunSocketIoBinding'] = async (runtime, io) => {
      markInitializationStarted();
      await initializationGate;
      await installBinding(runtime, io);
    };
    const initialization = service.getServerAsync();
    await initializationStarted;

    // When
    const shutdown = service.onApplicationShutdown();
    releaseInitialization();
    await Promise.all([initialization, shutdown]);

    // Then
    expect(service['io']).toBeUndefined();
    expect(service['bunEngine']).toBeUndefined();
    expect(adapter.currentBinding).toBeUndefined();
  });

  it('completes both runtime shutdown hooks at the shared deadline while Bun initialization is pending and cleans the late server', async () => {
    // Given
    const adapter = new TestBunAdapter(false, false);
    let markBindingCleared = (): void => undefined;
    const bindingCleared = new Promise<void>((resolve) => {
      markBindingCleared = resolve;
    });
    const setRealtimeBinding = adapter.setRealtimeBinding.bind(adapter);
    adapter.setRealtimeBinding = (binding: unknown | undefined) => {
      if (binding === undefined) {
        markBindingCleared();
      }
      setRealtimeBinding(binding);
    };
    const service = createLifecycleService(adapter, { shutdown: { timeoutMs: 100 } });
    const { initializationStarted, releaseInitialization } = gateInitialization(service);
    const initialization = service.getServerAsync();
    await initializationStarted;
    const bootstrap = service.onApplicationBootstrap();

    // When
    vi.useFakeTimers();
    let destroySettled = false;
    void service.onModuleDestroy().then(() => {
      destroySettled = true;
    });
    await vi.advanceTimersByTimeAsync(50);
    let applicationShutdownSettled = false;
    void service.onApplicationShutdown().then(() => {
      applicationShutdownSettled = true;
    });
    await vi.advanceTimersByTimeAsync(49);

    expect(destroySettled).toBe(false);
    expect(applicationShutdownSettled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    expect(destroySettled).toBe(true);
    expect(applicationShutdownSettled).toBe(true);

    vi.useRealTimers();
    releaseInitialization();
    await initialization;
    await bootstrap;
    await bindingCleared;

    // Then
    expect(service['io']).toBeUndefined();
    expect(service['bunEngine']).toBeUndefined();
    expect(adapter.currentBinding).toBeUndefined();
    expect(() => service.getServer()).toThrow();
    await expect(service.getServerAsync()).rejects.toThrow();
  });

  it('retains the late-initialized server for a deliberate retry when late cleanup fails', async () => {
    // Given
    const adapter = new TestBunAdapter(false, false);
    const cleanupFailures: unknown[] = [];
    let markCleanupFailure = (): void => undefined;
    const lateCleanupFailed = new Promise<void>((resolve) => {
      markCleanupFailure = resolve;
    });
    const service = createLifecycleService(
      adapter,
      { shutdown: { timeoutMs: 100 } },
      {
        ...silentLogger,
        error(_message: string, error?: unknown) {
          cleanupFailures.push(error);
          markCleanupFailure();
        },
      },
    );
    const { getCapturedServer, initializationStarted, releaseInitialization } = gateInitialization(service);
    const initialization = service.getServerAsync();
    await initializationStarted;

    // When
    vi.useFakeTimers();
    let applicationShutdownSettled = false;
    void service.onApplicationShutdown().then(() => {
      applicationShutdownSettled = true;
    });
    await vi.advanceTimersByTimeAsync(100);

    expect(applicationShutdownSettled).toBe(true);

    vi.useRealTimers();
    const lateServer = getCapturedServer();
    if (!lateServer) {
      throw new Error('Expected the gated Bun initialization to capture its server.');
    }
    let closeAttempts = 0;
    const originalClose = lateServer.close.bind(lateServer) as (callback?: () => void) => unknown;
    lateServer.close = ((callback?: () => void) => {
      closeAttempts += 1;
      if (closeAttempts === 1) {
        throw new Error('late cleanup close failed');
      }
      return originalClose(callback);
    }) as typeof lateServer.close;

    releaseInitialization();
    await initialization;
    await lateCleanupFailed;

    // Then
    expect(closeAttempts).toBe(1);
    expect(cleanupFailures[0]).toBeInstanceOf(Error);
    expect(service['io']).toBe(lateServer);
    expect(service['bunEngine']).toBeDefined();
    expect(adapter.currentBinding).toBeDefined();

    const retry = service.retryShutdown();
    await retry;

    expect(closeAttempts).toBe(2);
    expect(service['io']).toBeUndefined();
    expect(service['bunEngine']).toBeUndefined();
    expect(adapter.currentBinding).toBeUndefined();
  });

  it('does not reinstall gateway state from a late bootstrap continuation', async () => {
    // Given
    const adapter = new TestBunAdapter(false, false);
    let markBindingCleared = (): void => undefined;
    const bindingCleared = new Promise<void>((resolve) => {
      markBindingCleared = resolve;
    });
    const setRealtimeBinding = adapter.setRealtimeBinding.bind(adapter);
    adapter.setRealtimeBinding = (binding: unknown | undefined) => {
      if (binding === undefined) {
        markBindingCleared();
      }
      setRealtimeBinding(binding);
    };

    @WebSocketGateway({ path: '/chat' })
    class LateBootstrapGateway {}

    class LateBootstrapAppModule {}

    const service = new SocketIoLifecycleService(
      new Container(),
      [
        {
          accessibleTokens: new Set(),
          definition: { providers: [LateBootstrapGateway] },
          exportedTokens: new Set(),
          importedExportedTokens: new Set(),
          providerTokens: new Set(),
          type: LateBootstrapAppModule,
        },
      ] as never,
      silentLogger,
      adapter,
      { shutdown: { timeoutMs: 100 } },
    );
    const { initializationStarted, releaseInitialization } = gateInitialization(service);
    const bindCalls: unknown[] = [];

    Reflect.set(service, 'bindNamespaceHandlers', (attachment: unknown) => {
      bindCalls.push(attachment);
    });

    const initialization = service.getServerAsync();
    await initializationStarted;
    const bootstrap = service.onApplicationBootstrap();

    // When
    vi.useFakeTimers();
    let applicationShutdownSettled = false;
    void service.onApplicationShutdown().then(() => {
      applicationShutdownSettled = true;
    });
    await vi.advanceTimersByTimeAsync(100);

    expect(applicationShutdownSettled).toBe(true);

    vi.useRealTimers();
    releaseInitialization();
    await Promise.all([initialization, bootstrap, bindingCleared]);

    // Then
    expect(bindCalls).toHaveLength(0);
    expect(service['wired']).toBe(false);
    expect(service['attachments']).toEqual([]);
    expect(service['io']).toBeUndefined();
    expect(adapter.currentBinding).toBeUndefined();
  });
});
