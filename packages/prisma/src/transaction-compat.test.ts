import { describe, expect, it } from 'vitest';

import { Transaction } from './transaction.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Tx = Transaction as any;

function makeMockPrismaService() {
  return {
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    },
  };
}

describe('Transaction decorator method semantics', () => {
  it('propagates return value from decorated method', async () => {
    const prisma = makeMockPrismaService();

    class UserService {
      prisma = prisma;

      @Tx()
      async getValue(): Promise<number> {
        return 42;
      }
    }

    const svc = new UserService();
    await expect(svc.getValue()).resolves.toBe(42);
  });

  it('propagates synchronous throw from decorated method', async () => {
    const prisma = makeMockPrismaService();

    class UserService {
      prisma = prisma;

      @Tx()
      async failSync(): Promise<never> {
        throw new Error('boom');
      }
    }

    const svc = new UserService();
    await expect(svc.failSync()).rejects.toThrow('boom');
  });

  it('propagates async rejection from decorated method', async () => {
    const prisma = makeMockPrismaService();

    class UserService {
      prisma = prisma;

      @Tx()
      async failAsync(): Promise<never> {
        return Promise.reject(new Error('async-boom'));
      }
    }

    const svc = new UserService();
    await expect(svc.failAsync()).rejects.toThrow('async-boom');
  });

  it('preserves this binding inside decorated method', async () => {
    const prisma = makeMockPrismaService();

    class UserService {
      prisma = prisma;
      label = 'hello';

      @Tx()
      async getLabel(): Promise<string> {
        return this.label;
      }
    }

    const svc = new UserService();
    await expect(svc.getLabel()).resolves.toBe('hello');
  });
});
