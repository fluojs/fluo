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

  it('untracks only the selected handle in multi-handle isolation', async () => {
    const active = new Set<ActiveRequestTransaction>();
    const firstController = new AbortController();
    const secondController = new AbortController();
    const firstHandle = trackActiveRequestTransaction(active, firstController);
    const secondHandle = trackActiveRequestTransaction(active, secondController);
    let firstSettled = false;
    let secondSettled = false;
    const observedFirst = firstHandle.active.settled.then(() => {
      firstSettled = true;
    });
    const observedSecond = secondHandle.active.settled.then(() => {
      secondSettled = true;
    });

    untrackActiveRequestTransaction(active, firstHandle);

    await observedFirst;
    expect(firstSettled).toBe(true);
    expect(active.has(firstHandle.active)).toBe(false);
    expect(
      active.has(secondHandle.active),
      'second handle must remain tracked after the first is untracked',
    ).toBe(true);
    await Promise.resolve();
    expect(secondSettled, 'second handle must stay pending until its own untrack').toBe(false);

    untrackActiveRequestTransaction(active, secondHandle);

    await observedSecond;
    expect(secondSettled, 'second handle must settle after its own untrack').toBe(true);
    expect(active.has(secondHandle.active), 'second handle must be removed by its own untrack').toBe(
      false,
    );
    expect(active.size).toBe(0);
  });
});
