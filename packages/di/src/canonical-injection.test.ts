import { Inject, Module, Scope } from '@fluojs/core';
import { getClassDiMetadata, getOwnClassDiMetadata } from '@fluojs/core/internal';
import { describe, expect, it, vi } from 'vitest';

import * as di from './index.js';

describe('canonical injection declarations', () => {
  it('creates frozen deferred and optional wrappers without replacing tokens or resolvers', async () => {
    class Logger {}
    class Cache {}
    const resolver = vi.fn(() => Logger);
    const deferred = di.ForwardRef.create(resolver);
    const optional = di.Optional.create(Cache);

    expect(Object.isFrozen(deferred)).toBe(true);
    expect(Object.isFrozen(optional)).toBe(true);
    expect(deferred.forwardRef).toBe(resolver);
    expect(optional.token).toBe(Cache);
    expect(resolver).not.toHaveBeenCalled();
    expect(di.isForwardRef(deferred)).toBe(true);
    expect(di.isOptionalToken(optional)).toBe(true);

    @Inject(deferred, optional)
    class Service {
      constructor(readonly logger: Logger, readonly cache: Cache | undefined) {}
    }
    const container = new di.Container().register(Logger, Service);
    try {
      const service = await container.resolve(Service);
      expect(service).toBeInstanceOf(Service);
      expect(service.logger).toBe(await container.resolve(Logger));
      expect(service.cache).toBeUndefined();
      expect(resolver).toHaveBeenCalledOnce();
      expect(await container.resolve(Service)).toBe(service);
    } finally {
      await container.dispose();
    }
  });

  it('retains an empty inherited override and literal scope in either decorator order', async () => {
    const MISSING = Symbol('missing');
    @Inject(MISSING)
    @Scope('request')
    class Parent {
      constructor(readonly value?: unknown) {}
    }

    @Inject()
    @Scope('transient')
    class First extends Parent {}
    @Scope('transient')
    @Inject()
    class Second extends Parent {}
    class Inherited extends Parent {}

    expect(getOwnClassDiMetadata(Inherited)).toBeUndefined();
    expect(getClassDiMetadata(Inherited)?.inject).toEqual([MISSING]);
    expect(getClassDiMetadata(Parent)?.inject).toEqual([MISSING]);
    const container = new di.Container().register(First, Second);
    try {
      for (const token of [First, Second]) {
        expect(getOwnClassDiMetadata(token)).toEqual({ inject: [], scope: 'transient' });
        const instance = await container.resolve(token);
        expect(instance).toBeInstanceOf(Parent);
        expect(instance).toBeInstanceOf(token);
        expect(instance.value).toBeUndefined();
        expect(await container.resolve(token)).not.toBe(instance);
      }
    } finally {
      await container.dispose();
    }
  });

  it('does not expose the removed runtime spellings', async () => {
    const core = await import('@fluojs/core');
    expect(core).not.toHaveProperty('Global');
    expect(di).not.toHaveProperty('Scope');
    expect(di).not.toHaveProperty('forwardRef');
    expect(di).not.toHaveProperty('optional');
    expect(core.Module).toBe(Module);
    expect(core.Scope).toBe(Scope);
  });
});
