import { describe, expect, it } from 'vitest';

import { Container } from './container.js';
import { DuplicateProviderError, ScopeMismatchError } from './errors.js';
import { resolveMultiContribution } from './internal.js';
import type { ExistingProvider } from './types.js';

describe('multi alias providers (#4017)', () => {
  it('resolve: one multi alias returns an array containing the singleton target', async () => {
    class Plugin {}
    const token = Symbol('plugins');
    const alias: ExistingProvider = { provide: token, useExisting: Plugin, multi: true };
    const container = new Container().register(Plugin, alias);

    const plugins = await container.resolve<Plugin[]>(token);

    expect(plugins).toEqual([await container.resolve(Plugin)]);
    expect(plugins[0]).toBe(await container.resolve(Plugin));
  });

  it('resolve: multi aliases keep their position among other contributions', async () => {
    class Plugin {}
    const token = Symbol('plugins');
    const container = new Container().register(
      Plugin,
      { provide: token, useValue: 'first', multi: true },
      { provide: token, useExisting: Plugin, multi: true },
      { provide: token, useFactory: () => 'last', multi: true },
    );

    const plugins = await container.resolve(token);

    expect(plugins).toEqual(['first', await container.resolve(Plugin), 'last']);
  });

  it('resolve: transient alias targets produce a fresh instance each time', async () => {
    class Plugin {}
    const token = Symbol('plugins');
    const container = new Container().register(
      { provide: Plugin, useClass: Plugin, scope: 'transient' },
      { provide: token, useExisting: Plugin, multi: true },
    );

    const first = await container.resolve<Plugin[]>(token);
    const second = await container.resolve<Plugin[]>(token);

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0]).toBeInstanceOf(Plugin);
    expect(second[0]).not.toBe(first[0]);
  });

  it('resolve: request alias targets share only their request scope cache', async () => {
    class Plugin {}
    const token = Symbol('plugins');
    const root = new Container().register(
      { provide: Plugin, useClass: Plugin, scope: 'request' },
      { provide: token, useExisting: Plugin, multi: true },
    );
    const first = root.createRequestScope();
    const second = root.createRequestScope();

    const plugins = await first.resolve<Plugin[]>(token);

    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toBe(await first.resolve(Plugin));
    expect(plugins[0]).not.toBe(await second.resolve(Plugin));
    await root.dispose();
  });

  it('resolve: singleton injection rejects request aliases before any construction', async () => {
    const token = Symbol('plugins');
    let constructions = 0;
    class Plugin {
      constructor() {
        constructions += 1;
      }
    }
    class Consumer {
      constructor() {
        constructions += 1;
      }
    }
    const container = new Container().register(
      { provide: Plugin, useClass: Plugin, scope: 'request' },
      { provide: token, useFactory: () => { constructions += 1; return 'first'; }, multi: true },
      { provide: token, useExisting: Plugin, multi: true },
      { provide: Consumer, useClass: Consumer, inject: [token] },
    );

    await expect(container.createRequestScope().resolve(Consumer)).rejects.toThrow(ScopeMismatchError);

    expect(constructions).toBe(0);
  });

  it('hasRequestScopedDependency: multi alias follows the request target', () => {
    const token = Symbol('plugins');
    class Plugin {}
    const container = new Container().register(
      { provide: Plugin, useClass: Plugin, scope: 'request' },
      { provide: token, useExisting: Plugin, multi: true },
    );

    expect(container.hasRequestScopedDependency(token)).toBe(true);
  });

  it('override: multi aliases replace the complete materialized contribution set', async () => {
    const token = Symbol('plugins');
    class First {}
    class Second {}
    const container = new Container().register(
      First, Second,
      { provide: token, useValue: 'old-first', multi: true },
      { provide: token, useValue: 'old-second', multi: true },
    );
    await container.resolve(token);

    container.override(
      { provide: token, useExisting: Second, multi: true },
      { provide: token, useExisting: First, multi: true },
    );

    const plugins = await container.resolve<unknown[]>(token);
    expect(plugins).toHaveLength(2);
    expect(plugins[0]).toBe(await container.resolve(Second));
    expect(plugins[1]).toBe(await container.resolve(First));
  });

  it('override: mixing a multi alias and single replacement rejects the whole batch', async () => {
    const token = Symbol('plugins');
    class Plugin {}
    const container = new Container().register(Plugin, { provide: token, useValue: 'original', multi: true });

    expect(() => container.override(
      { provide: token, useExisting: Plugin, multi: true },
      { provide: token, useValue: 'single' },
    )).toThrow(DuplicateProviderError);

    await expect(container.resolve(token)).resolves.toEqual(['original']);
  });

  it('resolveMultiContribution: alias index resolves the target instance', async () => {
    const token = Symbol('plugins');
    class Plugin {}
    const container = new Container().register(
      Plugin,
      { provide: token, useValue: 'first', multi: true },
      { provide: token, useExisting: Plugin, multi: true },
    );

    const plugin = await resolveMultiContribution(container, token, 1);

    expect(plugin).toBe(await container.resolve(Plugin));
  });
});
