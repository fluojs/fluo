import { expect, it } from 'vitest';

import { FluoFactory } from './bootstrap.js';
import { defineRuntimeModuleMetadata } from './internal/core-metadata.js';
import type { MicroserviceApplication, MicroserviceRuntime } from './types.js';

it.each([
  { contextFails: false, transportFails: false },
  { contextFails: false, transportFails: true },
  { contextFails: true, transportFails: false },
  { contextFails: true, transportFails: true },
])('close: notification throws with $transportFails transport and $contextFails context failures -> caches ordered failures after all cleanup', async ({ contextFails, transportFails }) => {
  // Given
  const events: string[] = [];
  const notificationError = new Error('notification failed');
  const transportError = new Error('transport failed');
  const contextError = new Error('context failed');
  let app: MicroserviceApplication;
  let reenteredClose: Promise<unknown> | undefined;
  class Runtime implements MicroserviceRuntime {
    markShutdownStarted(): void {
      expect(this).toBe(runtime);
      events.push('notification');
      reenteredClose = app.close('reentrant').catch((error: unknown) => error);
      throw notificationError;
    }

    async listen(): Promise<void> {}

    async close(signal?: string): Promise<void> {
      events.push(`transport:${signal}`);
      if (transportFails) {
        throw transportError;
      }
    }
  }
  const runtime = new Runtime();
  class Cleanup {
    onApplicationShutdown(signal?: string): void {
      events.push(`context:${signal}`);
      if (contextFails) {
        throw contextError;
      }
    }
  }
  class AppModule {}
  defineRuntimeModuleMetadata(AppModule, {
    providers: [Cleanup, { provide: Symbol.for('fluo.microservices.service'), useValue: runtime }],
  });
  app = await FluoFactory.createMicroservice(AppModule);

  // When
  const first = app.close('SIGTERM').catch((error: unknown) => error);
  const concurrent = app.close('concurrent').catch((error: unknown) => error);

  // Then
  const result = await first;
  const expectedErrors = [notificationError, ...(transportFails ? [transportError] : []), ...(contextFails ? [contextError] : [])];
  if (expectedErrors.length === 1) {
    expect(result).toBe(notificationError);
  } else {
    expect(result).toBeInstanceOf(AggregateError);
    if (result instanceof AggregateError) {
      expect(result.errors).toEqual(expectedErrors);
      expectedErrors.forEach((error, index) => {
        expect(result.errors[index]).toBe(error);
      });
    }
  }
  expect(await concurrent).toBe(result);
  expect(reenteredClose).toBeDefined();
  expect(await reenteredClose).toBe(result);
  await expect(app.close('later')).rejects.toBe(result);
  await expect(app.send('test', {})).rejects.toThrow('Microservice cannot send after shutdown has started.');
  await expect(app.emit('test', {})).rejects.toThrow('Microservice cannot emit after shutdown has started.');
  await expect(app.listen()).rejects.toThrow('Microservice cannot listen after it has been closed.');
  expect(app.state).toBe('bootstrapped');
  expect(events).toEqual(['notification', 'transport:SIGTERM', 'context:SIGTERM']);
});

it.each([false, true])('close: notification throws while listen rejects=$0 -> waits for startup settlement before cleanup', async (listenFails) => {
  // Given
  const events: string[] = [];
  const notificationError = new Error('notification failed');
  const startupError = new Error('listen failed');
  let finishListen: () => void = () => undefined;
  const listening = new Promise<void>((resolve) => {
    finishListen = resolve;
  });
  class Runtime implements MicroserviceRuntime {
    markShutdownStarted(): void {
      events.push('notification');
      throw notificationError;
    }

    async listen(): Promise<void> {
      events.push('listen:start');
      await listening;
      events.push('listen:settled');
      if (listenFails) {
        throw startupError;
      }
    }

    async close(signal?: string): Promise<void> {
      events.push(`transport:${signal}`);
    }
  }
  class Cleanup {
    onApplicationShutdown(signal?: string): void {
      events.push(`context:${signal}`);
    }
  }
  class AppModule {}
  defineRuntimeModuleMetadata(AppModule, {
    providers: [Cleanup, { provide: Symbol.for('fluo.microservices.service'), useClass: Runtime }],
  });
  const app = await FluoFactory.createMicroservice(AppModule);
  const startup = app.listen().catch((error: unknown) => error);

  // When
  let closeSettled = false;
  const close = app.close('SIGINT').catch((error: unknown) => {
    closeSettled = true;
    return error;
  });

  // Then
  try {
    await expect(app.send('test', {})).rejects.toThrow('Microservice cannot send after shutdown has started.');
    await expect(app.emit('test', {})).rejects.toThrow('Microservice cannot emit after shutdown has started.');
    await expect(app.listen()).rejects.toThrow('Microservice cannot listen after it has been closed.');
    expect(closeSettled).toBe(false);
    expect(events).toEqual(['listen:start', 'notification']);
  } finally {
    finishListen();
    const startupResult = await startup;
    if (listenFails) {
      expect(startupResult).toBe(startupError);
    } else {
      expect(startupResult).toBeInstanceOf(Error);
      expect(startupResult).toHaveProperty('message', 'Microservice startup was interrupted by shutdown.');
    }
    expect(await close).toBe(notificationError);
  }
  expect(app.state).toBe('bootstrapped');
  expect(events).toEqual(['listen:start', 'notification', 'listen:settled', 'transport:SIGINT', 'context:SIGINT']);
});

it('connected close: notification and transport throw -> preserves parent ownership and child-before-parent cleanup', async () => {
  // Given
  const events: string[] = [];
  const notificationError = new Error('notification failed');
  const transportError = new Error('transport failed');
  class Runtime implements MicroserviceRuntime {
    markShutdownStarted(): void {
      events.push('notification');
      throw notificationError;
    }

    async listen(): Promise<void> {}

    async close(signal?: string): Promise<void> {
      events.push(`transport:${signal}`);
      throw transportError;
    }
  }
  class Cleanup {
    onApplicationShutdown(signal?: string): void {
      events.push(`parent:${signal}`);
    }
  }
  class AppModule {}
  defineRuntimeModuleMetadata(AppModule, {
    providers: [Cleanup, { provide: Symbol.for('fluo.microservices.service'), useClass: Runtime }],
  });
  const parent = await FluoFactory.create(AppModule, {
    adapter: {
      async close(signal?: string) {
        events.push(`adapter:${signal}`);
      },
      async listen() {},
    },
  });
  const child = await parent.connectMicroservice();

  // When
  const result: unknown = await child.close('SIGINT').catch((error: unknown) => error);

  // Then
  expect(result).toBeInstanceOf(AggregateError);
  if (result instanceof AggregateError) {
    expect(result.errors).toEqual([notificationError, transportError]);
  }
  expect(events).toEqual(['notification', 'transport:SIGINT']);
  expect(parent.state).toBe('bootstrapped');
  await expect(parent.close('SIGTERM')).rejects.toBe(result);
  await expect(child.close()).rejects.toBe(result);
  expect(events).toEqual(['notification', 'transport:SIGINT', 'parent:SIGTERM', 'adapter:SIGTERM']);
});
