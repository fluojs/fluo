import type { Application, ApplicationLogger } from '@fluojs/runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as platform from './index.js';
import { createBunShutdownSignalRegistration } from './shutdown.js';

const originalExitCode = process.exitCode;

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = originalExitCode;
});

function createLogger(): ApplicationLogger {
  return { debug() {}, error() {}, log() {}, warn() {} };
}

describe('Bun host shutdown registration', () => {
  it('exposes host-owned shutdown registration without a run helper', () => {
    expect(Reflect.get(platform, 'createBunShutdownSignalRegistration')).toBeTypeOf('function');
    expect(Reflect.has(platform, 'runBunApplication')).toBe(false);
    expect(Reflect.has(platform, 'bootstrapBunApplication')).toBe(false);
  });

  it('registers, closes through the exact signal handler, and unregisters every Bun binding', async () => {
    const bindings = new Map<string, () => void>();
    vi.spyOn(process, 'once').mockImplementation(((signal: string, handler: () => void) => {
      bindings.set(signal, handler);
      return process;
    }) as typeof process.once);
    const off = vi.spyOn(process, 'off').mockImplementation(((signal: string, handler: () => void) => {
      expect(bindings.get(signal)).toBe(handler);
      bindings.delete(signal);
      return process;
    }) as typeof process.off);

    let resolveClose!: () => void;
    const closeObserved = new Promise<void>((resolve) => { resolveClose = resolve; });
    const app = {
      close: vi.fn(async (signal?: string) => {
        expect(signal).toBe('SIGTERM');
        resolveClose();
      }),
      state: 'bootstrapped',
    } as unknown as Application;

    const unregister = createBunShutdownSignalRegistration(['SIGINT', 'SIGTERM'])(app, createLogger());
    if (typeof unregister !== 'function') throw new TypeError('Expected Bun signal cleanup.');
    expect(bindings).toHaveLength(2);
    bindings.get('SIGTERM')?.();
    await closeObserved;
    unregister();
    expect(off).toHaveBeenCalledTimes(2);
    expect(bindings).toHaveLength(0);
  });

  it('rolls back registered Bun handlers when later registration fails', () => {
    const off = vi.spyOn(process, 'off').mockImplementation((() => process) as typeof process.off);
    vi.spyOn(process, 'once').mockImplementation(((signal: string) => {
      if (signal === 'SIGTERM') throw new Error('registration failed');
      return process;
    }) as typeof process.once);

    expect(() => createBunShutdownSignalRegistration(['SIGINT', 'SIGTERM'])(
      { state: 'bootstrapped' } as Application,
      createLogger(),
    )).toThrow('registration failed');
    expect(off).toHaveBeenCalledTimes(2);
  });

  it('logs close failures without calling process.exit', async () => {
    const bindings = new Map<string, () => void>();
    vi.spyOn(process, 'once').mockImplementation(((signal: string, handler: () => void) => {
      bindings.set(signal, handler);
      return process;
    }) as typeof process.once);
    const exit = vi.spyOn(process, 'exit');
    let resolveError!: () => void;
    const errorLogged = new Promise<void>((resolve) => { resolveError = resolve; });
    const closeError = new Error('close failed');
    const logger: ApplicationLogger = {
      debug() {},
      error(_message, error) {
        expect(error).toBe(closeError);
        resolveError();
      },
      log() {},
      warn() {},
    };
    const app = {
      async close() { throw closeError; },
      state: 'bootstrapped',
    } as unknown as Application;

    createBunShutdownSignalRegistration(['SIGINT'])(app, logger);
    bindings.get('SIGINT')?.();
    await errorLogged;
    expect(exit).not.toHaveBeenCalled();
  });
});
