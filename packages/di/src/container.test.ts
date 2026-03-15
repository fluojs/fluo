import { describe, expect, it } from 'vitest';

import { Inject, Scope } from '@konekti/core';

import { Container } from './container.js';
import { CircularDependencyError } from './errors.js';

describe('Container', () => {
  it('caches singleton providers', async () => {
    class Logger {}

    const container = new Container().register(Logger);

    const first = await container.resolve(Logger);
    const second = await container.resolve(Logger);

    expect(first).toBe(second);
  });

  it('supports factory providers with injected dependencies', async () => {
    class Logger {
      log(message: string) {
        return `logged:${message}`;
      }
    }

    const output = Symbol('output');

    const container = new Container().register(
      Logger,
      {
        provide: output,
        useFactory: (logger) => (logger as Logger).log('ok'),
        inject: [Logger],
      },
    );

    expect(await container.resolve(output)).toBe('logged:ok');
  });

  it('keeps request-scoped providers unique per request scope', async () => {
    let created = 0;

    class RequestStore {
      readonly id = ++created;
    }

    const root = new Container().register({
      provide: RequestStore,
      scope: 'request',
      useClass: RequestStore,
    });

    await expect(root.resolve(RequestStore)).rejects.toThrow('outside request scope');

    const requestA = root.createRequestScope();
    const requestB = root.createRequestScope();

    const a1 = await requestA.resolve(RequestStore);
    const a2 = await requestA.resolve(RequestStore);
    const b1 = await requestB.resolve(RequestStore);

    expect(a1).toBe(a2);
    expect(a1).not.toBe(b1);
  });

  it('supports @Inject and @Scope metadata for dependency tokens and scope', async () => {
    class Logger {}

    @Inject([Logger])
    @Scope('request')
    class RequestService {
      constructor(readonly logger: Logger) {}
    }

    const root = new Container().register(Logger, RequestService);

    await expect(root.resolve(RequestService)).rejects.toThrow('outside request scope');

    const requestScope = root.createRequestScope();
    const first = await requestScope.resolve(RequestService);
    const second = await requestScope.resolve(RequestService);

    expect(first).toBe(second);
    expect(first.logger).toBeInstanceOf(Logger);
  });

  describe('circular dependency detection', () => {
    it('throws CircularDependencyError for a direct cycle (A -> A)', async () => {
      const token = Symbol('SelfRef');

      const container = new Container().register({
        provide: token,
        useFactory: async (dep: unknown) => dep,
        inject: [token],
      });

      await expect(container.resolve(token)).rejects.toThrow(CircularDependencyError);
    });

    it('throws CircularDependencyError for a two-node cycle (A -> B -> A)', async () => {
      class ServiceA {
        constructor(public b: ServiceB) {}
      }

      class ServiceB {
        constructor(public a: ServiceA) {}
      }

      const container = new Container().register(
        { provide: ServiceA, useClass: ServiceA, inject: [ServiceB] },
        { provide: ServiceB, useClass: ServiceB, inject: [ServiceA] },
      );

      await expect(container.resolve(ServiceA)).rejects.toThrow(CircularDependencyError);
    });

    it('includes the full token path in the error message', async () => {
      class Alpha {
        constructor(public b: Beta) {}
      }

      class Beta {
        constructor(public a: Alpha) {}
      }

      const container = new Container().register(
        { provide: Alpha, useClass: Alpha, inject: [Beta] },
        { provide: Beta, useClass: Beta, inject: [Alpha] },
      );

      const error = await container.resolve(Alpha).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(CircularDependencyError);
      expect((error as CircularDependencyError).message).toContain('Alpha');
      expect((error as CircularDependencyError).message).toContain('Beta');
    });

    it('does not throw for a valid non-circular diamond dependency', async () => {
      class Shared {}

      class Left {
        constructor(public shared: Shared) {}
      }

      class Right {
        constructor(public shared: Shared) {}
      }

      class Root {
        constructor(public left: Left, public right: Right) {}
      }

      const container = new Container().register(
        Shared,
        { provide: Left, useClass: Left, inject: [Shared] },
        { provide: Right, useClass: Right, inject: [Shared] },
        { provide: Root, useClass: Root, inject: [Left, Right] },
      );

      const root = await container.resolve(Root);

      expect(root).toBeInstanceOf(Root);
      expect(root.left).toBeInstanceOf(Left);
      expect(root.right).toBeInstanceOf(Right);
      expect(root.left.shared).toBe(root.right.shared);
    });
  });
});
