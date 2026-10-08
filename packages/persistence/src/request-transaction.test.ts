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
    const remove = vi.spyOn(caller.signal, 'removeEventListener');
    const context = createRequestAbortContext(caller.signal);
    const reason = {};

    caller.abort(reason);
    context.cleanup();

    expect(context.signal.reason).toBe(reason);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
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

  it('does not forward cancellation after listener cleanup', () => {
    const caller = new AbortController();
    const context = createRequestAbortContext(caller.signal);
    context.cleanup();

    caller.abort({});

    expect(context.signal.aborted).toBe(false);
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
