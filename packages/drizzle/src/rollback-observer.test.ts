import { describe, expect, it } from 'vitest';

import {
  createDrizzleRollbackObserver,
  type TransactionRollbackObservation,
  TransactionRollbackCapabilityError,
  TransactionRollbackUnconfirmedError,
} from './index.js';

type DirectClient = {
  query(text: string): Promise<{ rows: unknown[] }>;
};

describe('directly connected Drizzle rollback observer BEGIN scope', { timeout: 2_000 }, () => {
  it('returns the original error after a rejected BEGIN and reuses the client for the next independent attempt', async () => {
    const beginError = new Error('server rejected BEGIN');
    const events: string[] = [];
    let beginCalls = 0;
    const client: DirectClient = {
      async query(text) {
        events.push(text);
        if (text === 'BEGIN') {
          beginCalls += 1;
          if (beginCalls === 1) throw beginError;
        }
        return { rows: [] };
      },
    };
    const observed = createDrizzleRollbackObserver(client);

    await expect(observed.rollbackObserver.run(async () => {
      await observed.client.query('BEGIN');
    })).rejects.toBe(beginError);
    expect(events).toEqual(['BEGIN']);

    const value = { committed: true };
    await expect(observed.rollbackObserver.run(async () => {
      await observed.client.query('BEGIN');
      await observed.client.query('COMMIT');
      return value;
    })).resolves.toBe(value);
    expect(events).toEqual(['BEGIN', 'BEGIN', 'COMMIT']);
  });

  it('keeps rejecting overlapped BEGIN from other scopes while the first is pending without releasing the owner', async () => {
    const beginError = new Error('server rejected BEGIN');
    const events: string[] = [];
    let rejectBegin!: (error: unknown) => void;
    const beginOutcome = new Promise<{ rows: unknown[] }>((_resolve, reject) => {
      rejectBegin = reject;
    });
    let beginCalls = 0;
    const client: DirectClient = {
      query(text) {
        events.push(text);
        if (text === 'BEGIN') {
          beginCalls += 1;
          if (beginCalls === 1) return beginOutcome;
        }
        return Promise.resolve({ rows: [] });
      },
    };
    const observed = createDrizzleRollbackObserver(client);

    const owner = observed.rollbackObserver.run(async () => {
      await observed.client.query('BEGIN');
    });
    expect(events).toEqual(['BEGIN']);

    for (let overlap = 0; overlap < 2; overlap += 1) {
      await expect(observed.rollbackObserver.run(async () => {
        await observed.client.query('BEGIN');
      })).rejects.toBeInstanceOf(TransactionRollbackCapabilityError);
    }
    expect(events).toEqual(['BEGIN']);

    rejectBegin(beginError);
    await expect(owner).rejects.toBe(beginError);

    await expect(observed.rollbackObserver.run(async () => {
      await observed.client.query('BEGIN');
      await observed.client.query('COMMIT');
    })).resolves.toBeUndefined();
    expect(events).toEqual(['BEGIN', 'BEGIN', 'COMMIT']);
  });

  it('never counts a rejected BEGIN as rollback confirmation for either the failed or the next attempt', async () => {
    const beginError = new Error('server rejected BEGIN');
    const events: string[] = [];
    let beginCalls = 0;
    const client: DirectClient = {
      async query(text) {
        events.push(text);
        if (text === 'BEGIN') {
          beginCalls += 1;
          if (beginCalls === 1) throw beginError;
        }
        return { rows: [] };
      },
    };
    const observed = createDrizzleRollbackObserver(client);
    let confirmation: TransactionRollbackObservation | undefined;

    await expect(observed.rollbackObserver.run(async () => {
      await expect(observed.client.query('BEGIN')).rejects.toBe(beginError);
      confirmation = observed.rollbackObserver.beginAttempt({});
    })).resolves.toBeUndefined();

    await expect(observed.rollbackObserver.run(async () => {
      await observed.client.query('BEGIN');
      await observed.client.query('ROLLBACK');
    })).resolves.toBeUndefined();
    expect(events).toEqual(['BEGIN', 'BEGIN', 'ROLLBACK']);

    if (!confirmation) throw new Error('Missing test observation.');
    const claimed = confirmation;
    expect(() => claimed.confirmRollback()).toThrow(TransactionRollbackUnconfirmedError);
  });
});
