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
  readonly stderr = new PassThrough();

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
    expect(process.stderr.listenerCount('data')).toBe(0);
    expect(process.listenerCount('error')).toBe(0);
    expect(process.listenerCount('exit')).toBe(0);
  });

  it('reports stdout and stderr when the viewer exits before announcing its URL', async () => {
    // Given: a viewer process that emits startup diagnostics before an early exit.
    const process = new FakeViewerProcess('exit-on-sigterm');
    const reading = readViewerUrl(process, 10);
    process.stdout.write('startup phase one\n');
    process.stderr.write('failed to bind viewer port\n');

    // When: the process exits before writing its URL.
    process.emit('exit', 1, null);

    // Then: both bounded diagnostic streams explain the failure and all listeners are removed.
    await expect(reading).rejects.toThrow('stdout: startup phase one\n; stderr: failed to bind viewer port\n');
    expect(process.stdout.listenerCount('data')).toBe(0);
    expect(process.stderr.listenerCount('data')).toBe(0);
    expect(process.listenerCount('error')).toBe(0);
    expect(process.listenerCount('exit')).toBe(0);
  });

  it('cleans stdout, stderr, process listeners, and the timer after a startup error', async () => {
    // Given: a viewer process that has subscribed startup diagnostics.
    const process = new FakeViewerProcess('exit-on-sigterm');
    vi.useFakeTimers();
    const reading = readViewerUrl(process, 10);

    // When: startup reports a process error.
    const startupError = new Error('viewer executable failed');
    process.emit('error', startupError);

    // Then: the original error is retained without leaked listeners or a deadline timer.
    await expect(reading).rejects.toThrow(startupError);
    expect(process.stdout.listenerCount('data')).toBe(0);
    expect(process.stderr.listenerCount('data')).toBe(0);
    expect(process.listenerCount('error')).toBe(0);
    expect(process.listenerCount('exit')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds stdout and stderr and cleans listeners when no announcement arrives', async () => {
    // Given: a viewer process that emits diagnostics but never announces a URL.
    const process = new FakeViewerProcess('exit-on-sigterm');
    vi.useFakeTimers();

    // When: the startup deadline expires.
    const reading = readViewerUrl(process, 10);
    process.stdout.write('startup phase one\n');
    process.stderr.write('waiting for a missing dependency\n');
    const expectation = expect(reading).rejects.toThrow(
      'within 10ms: stdout: startup phase one\n; stderr: waiting for a missing dependency\n',
    );
    await vi.advanceTimersByTimeAsync(10);

    // Then: startup fails without retaining listeners or timers.
    await expectation;
    expect(process.stdout.listenerCount('data')).toBe(0);
    expect(process.stderr.listenerCount('data')).toBe(0);
    expect(process.listenerCount('error')).toBe(0);
    expect(process.listenerCount('exit')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
