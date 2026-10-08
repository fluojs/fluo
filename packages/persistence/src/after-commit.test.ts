import { expect, it } from 'vitest';
import { settleAfterCommitCallbacks } from './internal.js';

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
