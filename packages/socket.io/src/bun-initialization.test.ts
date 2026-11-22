import { Container } from '@fluojs/di';
import { createFetchStyleHttpAdapterRealtimeCapability, type Dispatcher, type HttpApplicationAdapter } from '@fluojs/http';
import type { ApplicationLogger } from '@fluojs/runtime';
import { BunHttpApplicationAdapter, type BunWebSocketBinding } from '@fluojs/platform-bun';
import { Server as BunEngineServer } from '@socket.io/bun-engine';
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
    return createFetchStyleHttpAdapterRealtimeCapability('Test adapter supports Bun-style Socket.IO binding.', {
      bindingInstallation: {
        install: (binding) => this.setRealtimeBinding(binding),
      },
      support: 'supported',
    });
  }

  listen(_dispatcher: Dispatcher): void {}
}

const silentLogger: ApplicationLogger = {
  debug() {},
  error() {},
  log() {},
  warn() {},
};

function createLifecycleService(adapter: HttpApplicationAdapter, options: SocketIoModuleOptions = {}): SocketIoLifecycleService {
  return new SocketIoLifecycleService(new Container(), [], silentLogger, adapter, options);
}

describe('SocketIoLifecycleService Bun initialization', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('preserves the official Bun host binding when CORS validation rejects before acquisition', async () => {
    vi.useFakeTimers();
    const adapter = BunHttpApplicationAdapter.create({});
    const binding: BunWebSocketBinding = {
      fetch: () => undefined,
      websocket: { open() {}, message() {}, close() {} },
    };
    const capability = adapter.getRealtimeCapability();
    const installation = capability.bindingInstallation;
    if (!installation) {
      throw new Error('Expected Bun binding installation capability.');
    }
    installation.install(binding);
    const install = vi.spyOn(installation, 'install');
    vi.spyOn(adapter, 'getRealtimeCapability').mockReturnValue(capability);
    const close = vi.spyOn(Server.prototype, 'close');
    const service = createLifecycleService(adapter, {
      cors: (_request, callback) => callback(null, {}),
    });

    const failure = service.getServerAsync().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);

    expect(Reflect.get(adapter, 'realtimeBinding')).toBe(binding);
    expect(install).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    await expect(failure).resolves.toMatchObject({
      message: expect.stringContaining('does not support CORS delegate functions'),
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports initialization and asynchronous close failures together without touching an unacquired host binding', async () => {
    vi.useFakeTimers();
    const adapter = new TestBunAdapter(false, false);
    const service = createLifecycleService(adapter);
    const initializationFailure = new Error('Engine handler failed.');
    const cleanupFailure = new Error('Engine close failed.');
    vi.spyOn(BunEngineServer.prototype, 'handler').mockImplementationOnce(() => {
      throw initializationFailure;
    });
    const close = vi.spyOn(BunEngineServer.prototype, 'close').mockImplementationOnce(() => {
      throw cleanupFailure;
    });
    const install = vi.spyOn(adapter, 'setRealtimeBinding');

    const resultsPromise = Promise.allSettled([service.getServerAsync(), service.getServerAsync()]);
    await vi.advanceTimersByTimeAsync(0);

    expect(close).toHaveBeenCalledTimes(1);
    expect(install).not.toHaveBeenCalled();
    const results = await resultsPromise;
    const first = results[0];
    const second = results[1];
    expect(first?.status).toBe('rejected');
    expect(second?.status).toBe('rejected');
    if (first?.status !== 'rejected' || second?.status !== 'rejected') {
      throw new Error('Expected shared initialization failure.');
    }
    expect(first.reason).toBeInstanceOf(AggregateError);
    expect(first.reason.errors).toHaveLength(2);
    expect(first.reason.errors[0]).toBe(initializationFailure);
    expect(first.reason.errors[1]).toBe(cleanupFailure);
    expect(second.reason).toBe(first.reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares a Bun binding failure with concurrent server callers', async () => {
    // Given
    const adapter = new TestBunAdapter();
    const service = createLifecycleService(adapter);

    // When
    const results = await Promise.allSettled([service.getServerAsync(), service.getServerAsync()]);

    // Then
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    if (results[0]?.status === 'rejected' && results[1]?.status === 'rejected') {
      expect(results[0].reason).toBeInstanceOf(TestBunBindingError);
      expect(results[1].reason).toBe(results[0].reason);
    }
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
    await service.onApplicationShutdown();
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
});
