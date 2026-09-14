import { describe, expect, it } from 'vitest';

import { Transaction } from './transaction.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeMockPrismaService() {
  return {
    createPlatformStatusSnapshot() {
      return {};
    },
    current() {
      return {};
    },
    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    },
  };
}

describe('Transaction decorator method semantics', () => {
  it('forwards native options and Fluo boundary options independently for an explicit target', async () => {
    // Given
    const nativeOptions = { timeout: 1_000 };
    const boundary = {};
    let transactionCalls = 0;
    const transaction = async <T>(
      callback: () => Promise<T>,
      options?: typeof nativeOptions,
      transactionBoundary?: typeof boundary,
    ): Promise<T> => {
      transactionCalls += 1;
      expect(options).toBe(nativeOptions);
      expect(transactionBoundary).toBe(boundary);

      return callback();
    };

    class UserService {
      prisma = {
        createPlatformStatusSnapshot() {
          return {};
        },
        current() {
          return {};
        },
        transaction,
      };

      @Transaction((self) => self.prisma, nativeOptions, boundary)
      async createUser(): Promise<string> {
        return 'created';
      }
    }

    // When
    const result = await new UserService().createUser();

    // Then
    expect(result).toBe('created');
    expect(transactionCalls).toBe(1);
  });

  it('propagates return value from decorated method', async () => {
    const prisma = makeMockPrismaService();

    class UserService {
      prisma = prisma;

      @Transaction((self) => self.prisma)
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

      @Transaction((self) => self.prisma)
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

      @Transaction((self) => self.prisma)
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

      @Transaction((self) => self.prisma)
      async getLabel(): Promise<string> {
        return this.label;
      }
    }

    const svc = new UserService();
    await expect(svc.getLabel()).resolves.toBe('hello');
  });
});
