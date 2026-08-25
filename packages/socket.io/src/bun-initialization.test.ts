import { Container } from '@fluojs/di';
import {
  createFetchStyleHttpAdapterRealtimeCapability,
  type Dispatcher,
  type HttpApplicationAdapter,
} from '@fluojs/http';
import type { ApplicationLogger } from '@fluojs/runtime';
import { Server } from 'socket.io';
import { describe, expect, it } from 'vitest';

import { SocketIoLifecycleService } from './adapter.js';

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

  configureRealtimeBinding(binding: unknown | undefined): void {
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
          install: (binding) => this.configureRealtimeBinding(binding),
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

function createLifecycleService(adapter: TestBunAdapter): SocketIoLifecycleService {
  return new SocketIoLifecycleService(new Container(), [], silentLogger, adapter, {});
}

describe('SocketIoLifecycleService Bun initialization', () => {
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
});
