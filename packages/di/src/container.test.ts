import { describe, expect, it } from 'vitest';

import { Inject, Scope } from '@konekti/core';

import { Container } from './container.js';
import { CircularDependencyError, DuplicateProviderError, ScopeMismatchError } from './errors.js';
import { forwardRef, optional } from './types.js';

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

  describe('transient scope', () => {
    it('creates a new instance on every resolve', async () => {
      let created = 0;

      class TransientService {
        readonly id = ++created;
      }

      const container = new Container().register({
        provide: TransientService,
        scope: 'transient',
        useClass: TransientService,
      });

      const first = await container.resolve(TransientService);
      const second = await container.resolve(TransientService);

      expect(first).not.toBe(second);
      expect(first.id).toBe(1);
      expect(second.id).toBe(2);
    });

    it('supports @Scope decorator for transient services', async () => {
      let created = 0;

      @Scope('transient')
      class TransientCounter {
        readonly id = ++created;
      }

      const container = new Container().register(TransientCounter);

      const first = await container.resolve(TransientCounter);
      const second = await container.resolve(TransientCounter);

      expect(first).not.toBe(second);
    });

    it('resolves transient providers from within request scope containers', async () => {
      let created = 0;

      class TransientService {
        readonly id = ++created;
      }

      const root = new Container().register({
        provide: TransientService,
        scope: 'transient',
        useClass: TransientService,
      });

      const requestScope = root.createRequestScope();

      const a = await requestScope.resolve(TransientService);
      const b = await requestScope.resolve(TransientService);

      expect(a).not.toBe(b);
    });

    it('allows a singleton to depend on a transient provider', async () => {
      class TransientDep {
        readonly value = 'dep';
      }

      class SingletonService {
        constructor(readonly dep: TransientDep) {}
      }

      const container = new Container().register(
        { provide: TransientDep, scope: 'transient', useClass: TransientDep },
        { provide: SingletonService, useClass: SingletonService, inject: [TransientDep] },
      );

      const instance = await container.resolve(SingletonService);

      expect(instance.dep.value).toBe('dep');
    });

    it('throws ScopeMismatchError when a singleton depends on a request-scoped provider', async () => {
      class RequestDep {}

      class SingletonService {
        constructor(readonly dep: RequestDep) {}
      }

      const container = new Container().register(
        { provide: RequestDep, scope: 'request', useClass: RequestDep },
        { provide: SingletonService, useClass: SingletonService, inject: [RequestDep] },
      );

      await expect(container.resolve(SingletonService)).rejects.toThrow(ScopeMismatchError);
    });
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

    it('resolves circular dependency between two providers using forwardRef', async () => {
      class ServiceA {
        constructor(public b: ServiceB) {}
      }

      class ServiceB {
        value = 'b';
      }

      const container = new Container().register(
        { provide: ServiceA, useClass: ServiceA, inject: [forwardRef(() => ServiceB)] },
        { provide: ServiceB, useClass: ServiceB, inject: [] },
      );

      const a = await container.resolve(ServiceA);

      expect(a).toBeInstanceOf(ServiceA);
      expect(a.b).toBeInstanceOf(ServiceB);
      expect(a.b.value).toBe('b');
    });
  });

  describe('duplicate provider detection', () => {
    it('throws DuplicateProviderError when registering the same token twice', async () => {
      class MyService {}

      expect(() =>
        new Container().register(MyService, MyService),
      ).toThrow(DuplicateProviderError);
    });

    it('allows override() to silently replace an existing provider', async () => {
      const token = Symbol('config');

      const container = new Container()
        .register({ provide: token, useValue: 'original' })
        .override({ provide: token, useValue: 'overridden' });

      expect(await container.resolve(token)).toBe('overridden');
    });

    it('invalidates singleton cache when overriding a previously resolved provider', async () => {
      const token = Symbol('cache-token');
      const container = new Container().register({ provide: token, useValue: { value: 'first' } });

      const first = await container.resolve<{ value: string }>(token);

      container.override({ provide: token, useValue: { value: 'second' } });

      const second = await container.resolve<{ value: string }>(token);

      expect(first).toEqual({ value: 'first' });
      expect(second).toEqual({ value: 'second' });
      expect(first).not.toBe(second);
    });

    it('replaces existing multi providers when overriding a token', async () => {
      const token = Symbol('plugins');
      const container = new Container().register(
        { provide: token, useValue: 'a', multi: true },
        { provide: token, useValue: 'b', multi: true },
      );

      expect(await container.resolve<string[]>(token)).toEqual(['a', 'b']);

      container.override({ provide: token, useValue: 'single' });

      expect(await container.resolve<string>(token)).toBe('single');
    });

    it('keeps root singleton cache isolated when overriding in a request scope', async () => {
      const token = Symbol('singleton-token');
      const rootSingleton = { value: 'root' };
      const requestOverride = { value: 'request' };

      const root = new Container().register({ provide: token, useValue: rootSingleton });
      const requestScope = root.createRequestScope();

      const rootBeforeOverride = await root.resolve<{ value: string }>(token);

      requestScope.override({ provide: token, useValue: requestOverride });

      const requestResolved = await requestScope.resolve<{ value: string }>(token);
      const rootAfterOverride = await root.resolve<{ value: string }>(token);
      const secondRequestScope = root.createRequestScope();
      const secondRequestResolved = await secondRequestScope.resolve<{ value: string }>(token);

      expect(rootBeforeOverride).toBe(rootSingleton);
      expect(rootAfterOverride).toBe(rootBeforeOverride);
      expect(requestResolved).toBe(requestOverride);
      expect(requestResolved).not.toBe(rootAfterOverride);
      expect(secondRequestResolved).toBe(rootAfterOverride);
    });
  });

  describe('optional injection', () => {
    it('injects undefined when an optional token is not registered', async () => {
      const LOGGER = Symbol('Logger');

      class MyService {
        constructor(public logger: unknown) {}
      }

      const container = new Container().register({
        provide: MyService,
        useClass: MyService,
        inject: [optional(LOGGER)],
      });

      const instance = await container.resolve(MyService);

      expect(instance.logger).toBeUndefined();
    });

    it('injects the resolved value when an optional token is registered', async () => {
      const LOGGER = Symbol('Logger');

      class Logger {
        readonly name = 'logger';
      }

      class MyService {
        constructor(public logger: Logger | undefined) {}
      }

      const container = new Container().register(
        { provide: LOGGER, useClass: Logger },
        { provide: MyService, useClass: MyService, inject: [optional(LOGGER)] },
      );

      const instance = await container.resolve(MyService);

      expect(instance.logger).toBeInstanceOf(Logger);
    });
  });

  describe('useExisting provider (alias)', () => {
    it('resolves the original instance via an alias token', async () => {
      class Logger {}

      const LOGGER_ALIAS = Symbol('LoggerAlias');

      const container = new Container().register(
        Logger,
        { provide: LOGGER_ALIAS, useExisting: Logger },
      );

      const original = await container.resolve(Logger);
      const alias = await container.resolve<Logger>(LOGGER_ALIAS);

      expect(alias).toBe(original);
    });
  });

  describe('multi-provider', () => {
    it('collects all multi providers into an array', async () => {
      const PLUGINS = Symbol('Plugins');

      class PluginA {}
      class PluginB {}

      const container = new Container().register(
        { provide: PLUGINS, useClass: PluginA, multi: true },
        { provide: PLUGINS, useClass: PluginB, multi: true },
      );

      const plugins = await container.resolve<unknown[]>(PLUGINS);

      expect(plugins).toHaveLength(2);
      expect(plugins[0]).toBeInstanceOf(PluginA);
      expect(plugins[1]).toBeInstanceOf(PluginB);
    });
  });

  describe('dispose', () => {
    it('calls onDestroy for resolved singleton instances in reverse creation order', async () => {
      const events: string[] = [];

      class FirstService {
        onDestroy() {
          events.push('first');
        }
      }

      class SecondService {
        onDestroy() {
          events.push('second');
        }
      }

      const container = new Container().register(FirstService, SecondService);

      await container.resolve(FirstService);
      await container.resolve(SecondService);
      await container.dispose();

      expect(events).toEqual(['second', 'first']);
    });

    it('disposes only the request cache for request-scoped containers', async () => {
      const events: string[] = [];

      class SingletonService {
        onDestroy() {
          events.push('singleton');
        }
      }

      class RequestService {
        onDestroy() {
          events.push('request');
        }
      }

      const root = new Container().register(
        SingletonService,
        { provide: RequestService, scope: 'request', useClass: RequestService },
      );

      const requestScope = root.createRequestScope();

      await root.resolve(SingletonService);
      await requestScope.resolve(RequestService);
      await requestScope.dispose();

      expect(events).toEqual(['request']);

      await root.dispose();

      expect(events).toEqual(['request', 'singleton']);
    });

    it('does not call onDestroy more than once', async () => {
      let disposed = 0;

      class DisposableService {
        onDestroy() {
          disposed += 1;
        }
      }

      const container = new Container().register(DisposableService);

      await container.resolve(DisposableService);
      await container.dispose();
      await container.dispose();

      expect(disposed).toBe(1);
    });

    it('rejects new resolves after dispose', async () => {
      class DisposableService {
        onDestroy() {}
      }

      const container = new Container().register(DisposableService);

      await container.resolve(DisposableService);
      await container.dispose();

      await expect(container.resolve(DisposableService)).rejects.toThrow('Container has been disposed');
    });

    it('rejects request scope creation after dispose', async () => {
      const container = new Container();

      await container.dispose();

      expect(() => container.createRequestScope()).toThrow('Container has been disposed');
    });

    it('continues disposal when one onDestroy fails', async () => {
      const events: string[] = [];

      class FirstService {
        onDestroy() {
          events.push('first');
          throw new Error('first failed');
        }
      }

      class SecondService {
        onDestroy() {
          events.push('second');
        }
      }

      const container = new Container().register(FirstService, SecondService);

      await container.resolve(FirstService);
      await container.resolve(SecondService);

      await expect(container.dispose()).rejects.toThrow('first failed');
      expect(events).toEqual(['second', 'first']);
    });

    it('disposes stale overridden singleton instances immediately and exactly once', async () => {
      const events: string[] = [];

      class FirstService {
        onDestroy() {
          events.push('first');
        }
      }

      class SecondService {
        onDestroy() {
          events.push('second');
        }
      }

      const token = Symbol('disposable-token');
      const container = new Container()
        .register({ provide: token, useClass: FirstService });

      await container.resolve(token);
      container.override({ provide: token, useClass: SecondService });
      await Promise.resolve();
      await container.resolve(token);

      await container.dispose();

      expect(events).toEqual(['first', 'second']);
    });

    it('does not retain stale singleton instances across repeated overrides', async () => {
      const events: string[] = [];
      const token = Symbol('rotating-disposable-token');

      class VersionedService {
        constructor(private readonly name: string) {}

        onDestroy() {
          events.push(this.name);
        }
      }

      const container = new Container().register({
        provide: token,
        useFactory: () => new VersionedService('v1'),
      });

      await container.resolve(token);

      container.override({
        provide: token,
        useFactory: () => new VersionedService('v2'),
      });
      await Promise.resolve();
      await container.resolve(token);

      container.override({
        provide: token,
        useFactory: () => new VersionedService('v3'),
      });
      await Promise.resolve();
      await container.resolve(token);

      await container.dispose();

      expect(events).toEqual(['v1', 'v2', 'v3']);
    });
  });
});
