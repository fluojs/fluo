import { defineModule, FluoFactory } from '@fluojs/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNodeShutdownSignalRegistration, NodeHttpApplicationAdapter } from './index.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Factory-owned Node signal registration', () => {
  it('rolls back acquired handlers when a later signal registration fails', async () => {
    // Given
    class AppModule {}
    defineModule(AppModule, {});
    const adapter = NodeHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 });
    const baseline = process.listeners('SIGINT');
    const failure = new Error('signal registration failed');
    const originalOnce = process.once;
    vi.spyOn(process, 'once').mockImplementation(function (this: NodeJS.Process, event, listener) {
      if (event === 'SIGTERM') throw failure;
      return originalOnce.call(this, event, listener);
    });
    const app = await FluoFactory.create(AppModule, {
      adapter,
      logger: { debug() {}, error() {}, log() {}, warn() {} },
      shutdownRegistration: createNodeShutdownSignalRegistration(),
    });
    // When / Then
    try {
      await expect(app.listen()).rejects.toBe(failure);
      expect(process.listeners('SIGINT')).toEqual(baseline);
      expect(adapter.getServer().listening).toBe(false);
      expect(app.state).toBe('closed');
    } finally {
      for (const listener of process.listeners('SIGINT')) {
        if (!baseline.includes(listener)) process.off('SIGINT', listener);
      }
    }
  });

  it('attempts every signal removal even when an earlier removal throws', async () => {
    // Given
    class AppModule {}
    defineModule(AppModule, {});
    const signals = ['SIGINT', 'SIGTERM'] as const;
    const before = new Map(signals.map((signal) => [signal, process.listeners(signal)]));
    const failure = new Error('signal removal failed');
    const app = await FluoFactory.create(AppModule, {
      adapter: NodeHttpApplicationAdapter.create({ host: '127.0.0.1', port: 0 }),
      logger: { debug() {}, error() {}, log() {}, warn() {} },
      shutdownRegistration: createNodeShutdownSignalRegistration(signals),
    });
    await app.listen();
    const originalOff = process.off;
    vi.spyOn(process, 'off').mockImplementation(function (this: NodeJS.Process, event, listener) {
      if (event === 'SIGINT') throw failure;
      return originalOff.call(this, event, listener);
    });
    try {
      // When / Then
      await expect(app.close()).rejects.toBe(failure);
      expect(process.listeners('SIGTERM')).toEqual(before.get('SIGTERM'));
      expect(app.state).toBe('closed');
    } finally {
      vi.restoreAllMocks();
      for (const signal of signals) {
        for (const listener of process.listeners(signal)) {
          if (!before.get(signal)?.includes(listener)) process.off(signal, listener);
        }
      }
    }
  });
});
