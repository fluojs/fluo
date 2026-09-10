import { describe, expect, it } from 'vitest';

import { Inject, Module, Scope } from './index.js';
import {
  getClassDiMetadata,
  getClassDiMetadataVersion,
  getModuleMetadata,
  getModuleMetadataVersion,
  getOwnClassDiMetadata,
} from './internal.js';

describe('canonical class declarations', () => {
  it('rejects legacy Inject arrays instead of flattening them', () => {
    expect(() => Reflect.apply(Inject, undefined, [[Symbol('token')]])).toThrow(TypeError);
    expect(() => Reflect.apply(Inject, undefined, [[]])).toThrow(TypeError);
  });

  it('snapshots spread tokens at factory time and preserves class identity', () => {
    class Token {}
    const tokens = [Token];
    const decorator = Inject(...tokens);
    tokens.length = 0;
    class Service {}
    const before = getClassDiMetadataVersion();
    expect(decorator(Service, { kind: 'class', name: 'Service', metadata: {}, addInitializer() {} })).toBeUndefined();
    expect(getClassDiMetadata(Service)?.inject).toEqual([Token]);
    expect(getClassDiMetadata(Service)?.inject?.[0]).toBe(Token);
    expect(Object.isFrozen(getClassDiMetadata(Service)?.inject)).toBe(true);
    expect(getClassDiMetadataVersion()).toBe(before + 1);
  });

  it('merges global module writes in evaluation order without leaking to subclasses', () => {
    @Module({ global: false })
    @Module()
    @Module({ global: true, exports: ['value'], providers: [{ provide: 'value', useValue: 1 }] })
    class Parent {}
    class Child extends Parent {}
    const previous = getModuleMetadata(Parent);
    const before = getModuleMetadataVersion();
    Module({ global: true })(Parent, { kind: 'class', name: 'Parent', metadata: {}, addInitializer() {} });

    expect(previous?.global).toBe(false);
    expect(Object.isFrozen(previous)).toBe(true);
    expect(getModuleMetadata(Parent)).toMatchObject({ global: true, exports: ['value'] });
    expect(getModuleMetadata(Child)).toBeUndefined();
    expect(getModuleMetadataVersion()).toBe(before + 1);
  });

  it('refreshes effective metadata after parent writes without changing child own overrides', () => {
    @Inject('first')
    @Scope('singleton')
    class Parent {}
    class Inherited extends Parent {}
    @Inject()
    class Cleared extends Parent {}
    const previous = getClassDiMetadata(Inherited);
    const own = getOwnClassDiMetadata(Cleared);
    const context: ClassDecoratorContext = { kind: 'class', name: 'Parent', metadata: {}, addInitializer() {} };
    Inject('second')(Parent, context);
    Scope('request')(Parent, context);

    expect(previous).toEqual({ inject: ['first'], scope: 'singleton' });
    expect(getOwnClassDiMetadata(Inherited)).toBeUndefined();
    expect(getClassDiMetadata(Inherited)).toEqual({ inject: ['second'], scope: 'request' });
    expect(getOwnClassDiMetadata(Cleared)).toBe(own);
    expect(getClassDiMetadata(Cleared)).toEqual({ inject: [], scope: 'request' });
  });
});
