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
  it('uses this.conn as the default transaction resolver first', async () => {
    const events: string[] = [];
    const conn = {
      async transaction<T>(fn: () => Promise<T>): Promise<T> {
        events.push('this.conn:transaction:start');
        const result = await fn();
        events.push('this.conn:transaction:end');

        return result;
      },
    };

    class UserService {
      conn = conn;

      @Transaction()
      async getValue(): Promise<number> {
        events.push('service:getValue');

        return 42;
      }
    }

    const svc = new UserService();

    await expect(svc.getValue()).resolves.toBe(42);
    expect(events).toEqual([
      'this.conn:transaction:start',
      'service:getValue',
      'this.conn:transaction:end',
    ]);
  });

  it('uses the decorated instance itself when it is transaction-capable and this.conn is absent', async () => {
    const events: string[] = [];

    class TransactionalService {
      async transaction<T>(fn: () => Promise<T>): Promise<T> {
        events.push('self:transaction:start');
        const result = await fn();
        events.push('self:transaction:end');

        return result;
      }

      @Transaction()
      async getValue(): Promise<string> {
        events.push('service:getValue');

        return 'self';
      }
    }

    const svc = new TransactionalService();

    await expect(svc.getValue()).resolves.toBe('self');
    expect(events).toEqual([
      'self:transaction:start',
      'service:getValue',
      'self:transaction:end',
    ]);
  });

  it('uses one unique nested this.*.conn collaborator when this.conn and self resolver are absent', async () => {
    const events: string[] = [];
    const repositoryConn = {
      async transaction<T>(fn: () => Promise<T>): Promise<T> {
        events.push('repository.conn:transaction:start');
        const result = await fn();
        events.push('repository.conn:transaction:end');

        return result;
      },
    };

    class UserService {
      readonly repository = { conn: repositoryConn };

      @Transaction()
      async create(): Promise<string> {
        events.push('service:create');

        return 'created';
      }
    }

    const svc = new UserService();

    await expect(svc.create()).resolves.toBe('created');
    expect(events).toEqual([
      'repository.conn:transaction:start',
      'service:create',
      'repository.conn:transaction:end',
    ]);
  });

  it('rejects ambiguous nested this.*.conn default resolver candidates', async () => {
    const events: string[] = [];
    const firstConn = {
      async transaction<T>(fn: () => Promise<T>): Promise<T> {
        events.push('first:transaction');

        return fn();
      },
    };
    const secondConn = {
      async transaction<T>(fn: () => Promise<T>): Promise<T> {
        events.push('second:transaction');

        return fn();
      },
    };

    class UserService {
      readonly primaryRepository = { conn: firstConn };
      readonly analyticsRepository = { conn: secondConn };

      @Transaction()
      async create(): Promise<string> {
        events.push('service:create');

        return 'created';
      }
    }

    const svc = new UserService();

    await expect(svc.create()).rejects.toThrow(
      'Mongoose @Transaction() found multiple nested this.*.conn candidates; pass an accessor.',
    );
    expect(events).toEqual([]);
  });

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
