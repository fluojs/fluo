import { expect, it } from 'vitest';
import { AfterCommitError } from './index.js';
import { settleAfterCommitCallbacks } from './internal.js';

it.each(['reordered', 'cleared'])(
  'AfterCommitError preserves its FIFO snapshot and reason identity when input is %s',
  (mutation) => {
    const first = { id: 1 };
    const second = { id: 2 };
    const success: PromiseFulfilledResult<void> = { status: 'fulfilled', value: undefined };
    const rejectedFirst: PromiseRejectedResult = { status: 'rejected', reason: first };
    const rejectedSecond: PromiseRejectedResult = { status: 'rejected', reason: second };
    const input: PromiseSettledResult<void>[] = [success, rejectedFirst, rejectedSecond];
    const error = new AfterCommitError(input);

    rejectedFirst.reason = { id: 3 };
    rejectedSecond.reason = { id: 4 };
    input.reverse();
    if (mutation === 'cleared') {
      input.length = 0;
    }

    expect(error.results).toEqual([
      { status: 'fulfilled', value: undefined },
      { status: 'rejected', reason: first },
      { status: 'rejected', reason: second },
    ]);
    expect(error.results).not.toBe(input);
    expect(error.results[0]).not.toBe(success);
    expect(error.results[1]).not.toBe(rejectedFirst);
    expect(error.results[2]).not.toBe(rejectedSecond);
    expect(error.results[1]?.status === 'rejected' && error.results[1].reason).toBe(first);
    expect(error.results[2]?.status === 'rejected' && error.results[2].reason).toBe(second);
    expect(error.errors).toEqual([first, second]);
    expect(error.errors[0]).toBe(first);
    expect(error.errors[1]).toBe(second);

    first.id = 5;
    expect(error.errors[0].id).toBe(5);
    expect(Object.isFrozen(first)).toBe(false);
  },
);

it('settles FIFO hooks after a failure without stopping later work', async () => {
  const events: string[] = [];
  const failure = new Error('hook failed');

  const results = await settleAfterCommitCallbacks([
    async () => { events.push('first'); },
    () => { events.push('second'); throw failure; },
    async () => { events.push('third'); },
  ]);

  expect(events).toEqual(['first', 'second', 'third']);
  expect(results).toEqual([
    { status: 'fulfilled', value: undefined },
    { status: 'rejected', reason: failure },
    { status: 'fulfilled', value: undefined },
  ]);
});
