import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readViewerUrl, stopViewerProcess } from './viewer-process.js';

type ExitBehavior = 'exit-on-sigkill' | 'exit-on-sigterm' | 'exit-with-code';

class FakeViewerProcess extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  readonly signals: NodeJS.Signals[] = [];
  readonly stdout = new PassThrough();

  constructor(private readonly exitBehavior: ExitBehavior) {
    super();
  }

  kill(signal: NodeJS.Signals): boolean {
    this.signals.push(signal);

    if (signal === 'SIGTERM' && this.exitBehavior === 'exit-on-sigterm') {
      this.signalCode = signal;
      this.emit('exit', null, signal);
    }

    if (signal === 'SIGTERM' && this.exitBehavior === 'exit-with-code') {
      this.exitCode = 0;
      this.emit('exit', 0, null);
    }

    if (signal === 'SIGKILL' && this.exitBehavior === 'exit-on-sigkill') {
      this.signalCode = signal;
      this.emit('exit', null, signal);
    }

    return true;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('installed viewer process lifecycle', () => {
  it('subscribes before SIGTERM and requires a SIGTERM exit result', async () => {
    // Given: a viewer that exits synchronously only after it receives SIGTERM.
    const process = new FakeViewerProcess('exit-on-sigterm');

    // When: the installed-viewer harness stops it.
    await expect(stopViewerProcess(process, 10)).resolves.toBeUndefined();

    // Then: the subscribed exit listener observes the expected termination and is cleaned up.
    expect(process.signals).toEqual(['SIGTERM']);
    expect(process.listenerCount('error')).toBe(0);
    expect(process.listenerCount('exit')).toBe(0);
  });

  it('escalates a non-cooperating viewer to SIGKILL and awaits its final exit', async () => {
    // Given: a viewer that ignores SIGTERM but exits when killed.
    const process = new FakeViewerProcess('exit-on-sigkill');
    vi.useFakeTimers();

    // When: the graceful shutdown deadline expires.
    const stopping = stopViewerProcess(process, 10);
    await vi.advanceTimersByTimeAsync(10);

    // Then: shutdown resolves only after the SIGKILL exit event and removes listeners.
    await expect(stopping).resolves.toBeUndefined();
    expect(process.signals).toEqual(['SIGTERM', 'SIGKILL']);
    expect(process.listenerCount('error')).toBe(0);
    expect(process.listenerCount('exit')).toBe(0);
  });

  it('rejects a viewer exit result that does not match the requested signal', async () => {
    // Given: a viewer that exits with a normal code after SIGTERM.
    const process = new FakeViewerProcess('exit-with-code');

    // When / Then: the lifecycle helper rejects the unexpected result.
    await expect(stopViewerProcess(process, 10)).rejects.toThrow('SIGTERM');
  });

  it('settles URL startup and removes output and process listeners', async () => {
    // Given: a running viewer process that prints its URL.
    const process = new FakeViewerProcess('exit-on-sigterm');
    const reading = readViewerUrl(process, 10);

    // When: stdout announces the local listener.
    process.stdout.write('Fluo Studio viewer: http://127.0.0.1:43123/\n');

    // Then: the URL resolves and every temporary listener is removed.
    await expect(reading).resolves.toEqual(new URL('http://127.0.0.1:43123/'));
    expect(process.stdout.listenerCount('data')).toBe(0);
    expect(process.listenerCount('error')).toBe(0);
    expect(process.listenerCount('exit')).toBe(0);
  });

  it('bounds URL startup and cleans listeners when no announcement arrives', async () => {
    // Given: a viewer process that remains silent.
    const process = new FakeViewerProcess('exit-on-sigterm');
    vi.useFakeTimers();

    // When: the startup deadline expires.
    const reading = readViewerUrl(process, 10);
    const expectation = expect(reading).rejects.toThrow('within 10ms');
    await vi.advanceTimersByTimeAsync(10);

    // Then: startup fails without retaining listeners or timers.
    await expectation;
    expect(process.stdout.listenerCount('data')).toBe(0);
    expect(process.listenerCount('error')).toBe(0);
    expect(process.listenerCount('exit')).toBe(0);
  });
});
