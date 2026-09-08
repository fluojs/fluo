/// <reference lib="es2024.promise" />

import { randomUUID } from 'node:crypto';

import { Module } from '@fluojs/core';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it, vi } from 'vitest';

import * as next from './index.js';

describe('defineNextApplication', () => {
  it('shares one pending application between independently defined accessors', async () => {
    // Given
    const key = `accessor-test/${randomUUID()}`;
    const started = Promise.withResolvers<void>();
    const loaded = Promise.withResolvers<{ readonly instance: string }>();
    let loads = 0;
    const first = next.defineNextApplication({
      key,
      load: () => {
        loads += 1;
        started.resolve();
        return loaded.promise;
      },
    });
    const second = next.defineNextApplication({
      key,
      load: async () => {
        loads += 1;
        return { instance: 'duplicate' };
      },
    });
    expect(loads).toBe(0);

    // When
    const firstPromise = first();
    const secondPromise = second();
    await started.promise;
    loaded.resolve({ instance: 'canonical' });

    // Then
    expect(secondPromise).toBe(firstPromise);
    await expect(firstPromise).resolves.toEqual({ instance: 'canonical' });
    expect(await secondPromise).toBe(await firstPromise);
    expect(loads).toBe(1);
  });

  it('keeps distinct application keys isolated even during initialization', async () => {
    // Given
    const loaded = Promise.withResolvers<object>();
    const left = next.defineNextApplication({ key: randomUUID(), load: () => loaded.promise });
    const rightValue = {};
    const right = next.defineNextApplication({ key: randomUUID(), load: async () => rightValue });

    // When
    const pending = left();
    const resolved = await right();
    loaded.resolve({});

    // Then
    expect(resolved).toBe(rightValue);
    expect(await pending).not.toBe(resolved);
  });

  it.each(['synchronous', 'asynchronous'])('retains %s failures across new definitions', async (mode) => {
    // Given
    const key = randomUUID();
    const failure = new Error('bootstrap failed');
    let attempts = 0;
    const get = next.defineNextApplication({
      key,
      load: () => {
        attempts += 1;
        if (mode === 'synchronous') throw failure;
        return Promise.reject(failure);
      },
    });

    // When
    const first = get();
    const second = get();
    await expect(first).rejects.toBe(failure);
    const replacement = next.defineNextApplication({ key, load: async () => 'replacement' });

    // Then
    expect(second).toBe(first);
    expect(replacement()).toBe(first);
    await expect(replacement()).rejects.toBe(failure);
    expect(attempts).toBe(1);
  });

  it('publishes the promise before a loader reenters the accessor', async () => {
    // Given
    let reentrant: Promise<object> | undefined;
    const value = {};
    const get = next.defineNextApplication({
      key: randomUUID(),
      load: async () => {
        reentrant = get();
        return value;
      },
    });

    // When
    const pending = get();
    await pending;

    // Then
    expect(reentrant).toBe(pending);
    expect(await pending).toBe(value);
  });

  it('retains the live graph after the accessor module is evaluated again', async () => {
    // Given
    const key = randomUUID();
    const graph = {};
    const get = next.defineNextApplication({ key, load: async () => graph });
    const original = get();
    await original;

    // When
    vi.resetModules();
    const reevaluated = await import('./application-accessor.js');
    const getAgain = reevaluated.defineNextApplication({ key, load: async () => ({}) });

    // Then
    expect(reevaluated.defineNextApplication).not.toBe(next.defineNextApplication);
    expect(getAgain()).toBe(original);
    expect(await getAgain()).toBe(graph);
  });

  it('leaves pending, failed, and completed disposal with the application owner', async () => {
    // Given
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const failure = new Error('resource disposal failed');
    let destroys = 0;
    let loads = 0;
    class Resource {
      async onDestroy() {
        destroys += 1;
        if (destroys === 1) {
          entered.resolve();
          await release.promise;
          throw failure;
        }
      }
    }
    @Module({ providers: [Resource] })
    class AppModule {}
    const key = randomUUID();
    const get = next.defineNextApplication({
      key,
      load: async () => {
        loads += 1;
        const adapter = next.createNextAdapter();
        const app = await FluoFactory.create(AppModule, { adapter });
        await app.listen();
        await app.container.resolve(Resource);
        return { app, adapter };
      },
    });
    const graph = await get();
    try {
      // When
      const closing = graph.app.close();
      const rejected = expect(closing).rejects.toBe(failure);
      await entered.promise;
      expect(await get()).toBe(graph);
      release.resolve();
      await rejected;
      expect(await get()).toBe(graph);
      await graph.app.close();

      // Then
      const fresh = next.defineNextApplication({ key, load: async () => graph });
      expect(fresh()).toBe(get());
      expect(destroys).toBe(2);
      expect(loads).toBe(1);
      expect(graph.app.state).toBe('closed');
      await expect(graph.adapter.GET(new Request('http://next.test/'))).resolves.toMatchObject({
        status: 503,
      });
      await expect(graph.app.container.resolve(Resource)).rejects.toThrow();
    } finally {
      release.resolve();
      await graph.app.close();
    }
  });
});
