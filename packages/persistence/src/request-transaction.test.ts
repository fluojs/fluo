import { describe, expect, it, vi } from 'vitest';
import {
  type ActiveRequestTransaction,
  createRequestAbortContext,
  trackActiveRequestTransaction,
  untrackActiveRequestTransaction,
} from './index.js';

describe('shared active transaction work', () => {
  it('forwards the exact abort reason and removes its registered listener', () => {
    const caller = new AbortController();
    const remove = vi.spyOn(AbortSignal.prototype, 'removeEventListener');
    const context = createRequestAbortContext(caller.signal);
    const reason = {};

    caller.abort(reason);
    context.cleanup();

    expect(context.signal.reason).toBe(reason);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    remove.mockRestore();
  });

  it('forwards cancellation when an earlier caller listener stops immediate propagation', () => {
    const caller = new AbortController();
    caller.signal.addEventListener('abort', (event) => event.stopImmediatePropagation(), { once: true });
    const context = createRequestAbortContext(caller.signal);
    const reason = {};

    try {
      caller.abort(reason);

      expect(context.signal.aborted).toBe(true);
      expect(context.signal.reason).toBe(reason);
    } finally {
      context.cleanup();
    }
  });

  it('forwards an already aborted input before work starts', () => {
    const caller = new AbortController();
    const reason = {};
    caller.abort(reason);

    const context = createRequestAbortContext(caller.signal);

    expect(context.signal.aborted).toBe(true);
    expect(context.signal.reason).toBe(reason);
    context.cleanup();
  });

  it.each([false, true])('does not forward cancellation after repeated cleanup (stopped event: %s)', (stopPropagation) => {
    const caller = new AbortController();
    if (stopPropagation) {
      caller.signal.addEventListener('abort', (event) => event.stopImmediatePropagation(), { once: true });
    }
    const context = createRequestAbortContext(caller.signal);
    context.cleanup();
    context.cleanup();
    expect(caller.signal.aborted).toBe(false);
    expect(context.signal.aborted).toBe(false);

    caller.abort({});

    expect(context.signal.aborted).toBe(false);
  });

  it('keeps local cancellation one-way and preserves its first reason', () => {
    const caller = new AbortController();
    const context = createRequestAbortContext(caller.signal);
    const reason = {};

    try {
      context.controller.abort(reason);

      expect(caller.signal.aborted).toBe(false);
      expect(context.signal.aborted).toBe(true);
      expect(context.signal.reason).toBe(reason);
      caller.abort({});
      expect(context.signal.reason).toBe(reason);
    } finally {
      context.cleanup();
    }
  });

  it('preserves the caller reason when the local controller aborts later', () => {
    const caller = new AbortController();
    const context = createRequestAbortContext(caller.signal);
    const reason = {};

    try {
      caller.abort(reason);
      context.controller.abort({});

      expect(context.signal.reason).toBe(reason);
    } finally {
      context.cleanup();
    }
  });

  it('creates independent contexts without an input signal', () => {
    const first = createRequestAbortContext();
    const second = createRequestAbortContext();
    const reason = {};

    try {
      first.cleanup();
      first.cleanup();
      first.controller.abort(reason);

      expect(first.signal.aborted).toBe(true);
      expect(first.signal.reason).toBe(reason);
      expect(second.signal.aborted).toBe(false);
    } finally {
      first.cleanup();
      second.cleanup();
    }
  });

  it('keeps registered work pending until untrack removes and settles it', async () => {
    const active = new Set<ActiveRequestTransaction>();
    const controller = new AbortController();
    const handle = trackActiveRequestTransaction(active, controller);
    let settled = false;
    const observed = handle.active.settled.then(() => {
      settled = true;
      expect(active.has(handle.active)).toBe(false);
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(active.has(handle.active)).toBe(true);
    const reason = {};
    handle.active.abort(reason);
    expect(controller.signal.reason).toBe(reason);

    untrackActiveRequestTransaction(active, handle);

    await observed;
    expect(settled).toBe(true);
    expect(active.size).toBe(0);
  });
});
