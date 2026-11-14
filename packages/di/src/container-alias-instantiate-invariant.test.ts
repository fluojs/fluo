import { describe, expect, it } from 'vitest';

import { Container } from './container.js';
import { CircularDependencyError, RequestScopeResolutionError, ScopeMismatchError } from './errors.js';

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return expect.fail('Expected the promise to reject.');
}

function chainOf(error: unknown): unknown {
  expect(error).toBeInstanceOf(CircularDependencyError);

  return (error as CircularDependencyError & { meta?: { chain?: unknown } }).meta?.chain;
}

describe('alias providers never reach instantiate() (#4023)', () => {
  describe('cycle detection through aliases', () => {
    it('reports the full chain when a transient class reaches itself through a single alias', async () => {
      const ALIAS = Symbol('ServiceAlias');
      class Service {
        constructor(readonly self: unknown) {}
      }
      const container = new Container().register(
        { provide: Service, useClass: Service, inject: [ALIAS], scope: 'transient' },
        { provide: ALIAS, useExisting: Service },
      );

      const error = await captureRejection(container.resolve(Service));

      expect(chainOf(error)).toEqual(['Service', 'Symbol(ServiceAlias)', 'Service']);
    });

    it('reports the full chain when a request-scoped class reaches itself through an empty-string alias', async () => {
      class Service {
        constructor(readonly self: unknown) {}
      }
      const root = new Container().register(
        { provide: Service, useClass: Service, inject: [''], scope: 'request' },
        { provide: '', useExisting: Service, scope: 'request' },
      );
      const request = root.createRequestScope();

      const error = await captureRejection(request.resolve(Service));

      expect(chainOf(error)).toEqual(['Service', '', 'Service']);
      await root.dispose();
    });

    it('reports the full chain when a multi alias contribution reaches its own multi token', async () => {
      const PLUGINS = Symbol('Plugins');
      class Plugin {
        constructor(readonly plugins: unknown) {}
      }
      const container = new Container().register(
        { provide: Plugin, useClass: Plugin, inject: [PLUGINS], scope: 'transient' },
        { provide: PLUGINS, useExisting: Plugin, multi: true },
      );

      const error = await captureRejection(container.resolve(PLUGINS));

      expect(chainOf(error)).toEqual(['Symbol(Plugins)', 'Plugin', 'Symbol(Plugins)']);
    });

    it('keeps resolving later requests after an alias cycle rejection', async () => {
      const ALIAS = Symbol('ServiceAlias');
      class Service {
        constructor(readonly self: unknown) {}
      }
      class Healthy {}
      const container = new Container().register(
        Healthy,
        { provide: Service, useClass: Service, inject: [ALIAS], scope: 'transient' },
        { provide: ALIAS, useExisting: Service },
        { provide: 'healthy-alias', useExisting: Healthy },
      );

      await expect(container.resolve(Service)).rejects.toBeInstanceOf(CircularDependencyError);

      await expect(container.resolve('healthy-alias')).resolves.toBe(await container.resolve(Healthy));
    });
  });

  describe('scopes', () => {
    it('shares one async singleton factory instance between concurrent alias and target resolutions', async () => {
      const TARGET = Symbol('AsyncTarget');
      let calls = 0;
      const container = new Container().register(
        {
          provide: TARGET,
          useFactory: async () => {
            calls += 1;
            return { id: calls };
          },
        },
        { provide: 'alias', useExisting: TARGET },
      );

      const [viaAlias, viaTarget] = await Promise.all([container.resolve('alias'), container.resolve(TARGET)]);

      expect(viaAlias).toBe(viaTarget);
      expect(calls).toBe(1);
    });

    it('produces a fresh instance for each alias resolution of a transient target', async () => {
      class Target {}
      const container = new Container().register(
        { provide: Target, useClass: Target, scope: 'transient' },
        { provide: '', useExisting: Target },
      );

      const first = await container.resolve('');
      const second = await container.resolve('');

      expect(first).toBeInstanceOf(Target);
      expect(second).not.toBe(first);
    });

    it('rejects an alias of a request-scoped target outside a request scope', async () => {
      const ALIAS = Symbol('RequestAlias');
      class Target {}
      const container = new Container().register(
        { provide: Target, useClass: Target, scope: 'request' },
        { provide: ALIAS, useExisting: Target, scope: 'request' },
      );

      await expect(container.resolve(ALIAS)).rejects.toBeInstanceOf(RequestScopeResolutionError);
    });
  });

  describe('singleton overrides in a request scope', () => {
    it('rejects register() of a singleton-scope provider on a request scope', () => {
      class Target {}
      const request = new Container().createRequestScope();

      expect(() => request.register(Target)).toThrow(ScopeMismatchError);
    });

    it('caches an override() replacement per request scope, shares it with nested children, and disposes it with the scope', async () => {
      const destroyed: string[] = [];
      class Target {
        constructor(readonly label: string) {}

        onDestroy(): void {
          destroyed.push(this.label);
        }
      }
      const root = new Container().register({ provide: Target, useFactory: () => new Target('root') });
      const rootInstance = await root.resolve(Target);
      const request = root.createRequestScope().override({ provide: Target, useFactory: () => new Target('request') });
      const nested = request.createRequestScope();
      const sibling = root.createRequestScope();

      const replacement = await request.resolve(Target);

      expect(replacement.label).toBe('request');
      expect(await nested.resolve(Target)).toBe(replacement);
      expect(await sibling.resolve(Target)).toBe(rootInstance);
      expect(await root.resolve(Target)).toBe(rootInstance);

      await request.dispose();

      expect(destroyed).toEqual(['request']);
      await root.dispose();
      expect(destroyed).toEqual(['request', 'root']);
    });

    it('resolves an alias override in a request scope through its target without leaking to the root', async () => {
      const ALIAS = Symbol('Alias');
      class Original {}
      class Replacement {}
      const root = new Container().register(
        Original,
        { provide: Replacement, useClass: Replacement, scope: 'request' },
        { provide: ALIAS, useExisting: Original },
      );
      const request = root.createRequestScope().override({ provide: ALIAS, useExisting: Replacement, scope: 'request' });

      expect(await request.resolve(ALIAS)).toBe(await request.resolve(Replacement));
      expect(await root.resolve(ALIAS)).toBe(await root.resolve(Original));
      await root.dispose();
    });
  });

  describe('disposal', () => {
    it('destroys an aliased singleton exactly once', async () => {
      let destroyed = 0;
      class Target {
        onDestroy(): void {
          destroyed += 1;
        }
      }
      const ALIAS = Symbol('Alias');
      const container = new Container().register(
        Target,
        { provide: ALIAS, useExisting: Target },
        { provide: 'multi', useExisting: ALIAS, multi: true },
      );

      await container.resolve(ALIAS);
      await container.resolve('multi');
      await container.dispose();

      expect(destroyed).toBe(1);
    });
  });
});
