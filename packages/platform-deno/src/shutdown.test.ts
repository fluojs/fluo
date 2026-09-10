import type { Application, ApplicationLogger } from '@fluojs/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as platform from './index.js';
import { createDenoShutdownSignalRegistration } from './shutdown.js';

const originalDeno = Reflect.get(globalThis, 'Deno');

afterEach(() => {
  if (originalDeno === undefined) {
    Reflect.deleteProperty(globalThis, 'Deno');
  } else {
    Reflect.set(globalThis, 'Deno', originalDeno);
  }
  vi.restoreAllMocks();
});

function createLogger(): ApplicationLogger {
  return { debug() {}, error() {}, log() {}, warn() {} };
}

describe('Deno host shutdown registration', () => {
  it('exposes host-owned shutdown registration without a run helper', () => {
    expect(Reflect.get(platform, 'createDenoShutdownSignalRegistration')).toBeTypeOf('function');
    expect(Reflect.has(platform, 'runDenoApplication')).toBe(false);
    expect(Reflect.has(platform, 'bootstrapDenoApplication')).toBe(false);
  });

  it('deduplicates Deno signals, closes through the exact registered handler, and unregisters every binding', async () => {
    const bindings = new Map<string, () => void>();
    const addSignalListener = vi.fn((signal: string, handler: () => void) => bindings.set(signal, handler));
    const removeSignalListener = vi.fn((signal: string, handler: () => void) => {
      expect(bindings.get(signal)).toBe(handler);
      bindings.delete(signal);
    });
    Reflect.set(globalThis, 'Deno', { addSignalListener, removeSignalListener });

    let resolveClose!: () => void;
    const closeObserved = new Promise<void>((resolve) => { resolveClose = resolve; });
    const app = {
      close: vi.fn(async (signal?: string) => {
        expect(signal).toBe('SIGTERM');
        resolveClose();
      }),
      state: 'bootstrapped',
    } as unknown as Application;

    const unregister = createDenoShutdownSignalRegistration(['SIGINT', 'SIGTERM', 'SIGINT'])(
      app,
      createLogger(),
    );
    expect(addSignalListener).toHaveBeenCalledTimes(2);
    bindings.get('SIGTERM')?.();
    await closeObserved;
    unregister();
    expect(removeSignalListener).toHaveBeenCalledTimes(2);
    expect(bindings).toHaveLength(0);
  });

  it('returns a no-op registration when the Deno signal host is absent', () => {
    Reflect.deleteProperty(globalThis, 'Deno');
    const unregister = createDenoShutdownSignalRegistration()(
      { state: 'bootstrapped' } as Application,
      createLogger(),
    );
    expect(unregister).not.toThrow();
  });

  it('rolls back registered Deno handlers when later registration fails', () => {
    const removeSignalListener = vi.fn();
    Reflect.set(globalThis, 'Deno', {
      addSignalListener(signal: string) {
        if (signal === 'SIGTERM') throw new Error('registration failed');
      },
      removeSignalListener,
    });

    expect(() => createDenoShutdownSignalRegistration(['SIGINT', 'SIGTERM'])(
      { state: 'bootstrapped' } as Application,
      createLogger(),
    )).toThrow('registration failed');
    expect(removeSignalListener).toHaveBeenCalledTimes(1);
  });

  it('logs close failures without host process termination', async () => {
    const bindings = new Map<string, () => void>();
    Reflect.set(globalThis, 'Deno', {
      addSignalListener(signal: string, handler: () => void) { bindings.set(signal, handler); },
      removeSignalListener() {},
    });
    let resolveError!: () => void;
    const errorLogged = new Promise<void>((resolve) => { resolveError = resolve; });
    const logger: ApplicationLogger = {
      debug() {},
      error(message) {
        expect(message).toContain('Failed to shut down the application cleanly.');
        resolveError();
      },
      log() {},
      warn() {},
    };
    const app = {
      async close() { throw new Error('close failed'); },
      state: 'bootstrapped',
    } as unknown as Application;

    createDenoShutdownSignalRegistration(['SIGINT'])(app, logger);
    bindings.get('SIGINT')?.();
    await errorLogged;
  });
});
