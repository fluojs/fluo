import { describe, expect, it } from 'vitest';

import { Transaction } from './transaction.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeMockMongooseConnection() {
  return {
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    },
  };
}

describe('Transaction decorator method semantics', () => {
  it('propagates return value from decorated method', async () => {
    const conn = makeMockMongooseConnection();

    class UserService {
      conn = conn;

      @Transaction()
      async getValue(): Promise<number> {
        return 42;
      }
    }

    const svc = new UserService();
    await expect(svc.getValue()).resolves.toBe(42);
  });

  it('propagates synchronous throw from decorated method', async () => {
    const conn = makeMockMongooseConnection();

    class UserService {
      conn = conn;

      @Transaction()
      async failSync(): Promise<never> {
        throw new Error('boom');
      }
    }

    const svc = new UserService();
    await expect(svc.failSync()).rejects.toThrow('boom');
  });

  it('propagates async rejection from decorated method', async () => {
    const conn = makeMockMongooseConnection();

    class UserService {
      conn = conn;

      @Transaction()
      async failAsync(): Promise<never> {
        return Promise.reject(new Error('async-boom'));
      }
    }

    const svc = new UserService();
    await expect(svc.failAsync()).rejects.toThrow('async-boom');
  });

  it('preserves this binding inside decorated method', async () => {
    const conn = makeMockMongooseConnection();

    class UserService {
      conn = conn;
      label = 'hello';

      @Transaction()
      async getLabel(): Promise<string> {
        return this.label;
      }
    }

    const svc = new UserService();
    await expect(svc.getLabel()).resolves.toBe('hello');
  });

  it('does not scan arbitrary host fields when the default this.conn boundary is absent', async () => {
    const events: string[] = [];
    const analyticsConn = {
      async transaction<T>(fn: () => Promise<T>): Promise<T> {
        events.push('analytics:transaction');

        return fn();
      },
    };

    class UserService {
      readonly analyticsConn = analyticsConn;

      @Transaction()
      async loadAnalytics(): Promise<string> {
        return 'analytics';
      }
    }

    const svc = new UserService();

    await expect(svc.loadAnalytics()).rejects.toThrow(
      'Mongoose @Transaction() could not resolve a transaction-capable connection from this.conn.',
    );
    expect(events).toEqual([]);
  });
});
