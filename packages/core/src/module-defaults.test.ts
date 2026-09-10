import { getModuleMetadata, Module } from '@fluojs/core';
import { getModuleMetadataVersion } from '@fluojs/core/internal';
import { describe, expect, it } from 'vitest';

describe('empty Module factory defaults', () => {
  it.each([
    { name: 'omitted', factory: () => Module() },
    { name: 'undefined', factory: () => Module(undefined) },
    { name: 'empty object', factory: () => Module({}) },
  ])('registers frozen metadata and increments the write version for $name', ({ factory }) => {
    // Given
    class Undecorated {}
    @Module({})
    class Explicit {}
    const before = getModuleMetadataVersion();
    const decorator = factory();

    // When
    @decorator
    class Empty {}

    // Then
    expect(getModuleMetadata(Undecorated)).toBeUndefined();
    expect(getModuleMetadata(Empty)).toEqual(getModuleMetadata(Explicit));
    expect(getModuleMetadata(Empty)).toBeDefined();
    expect(Object.isFrozen(getModuleMetadata(Empty))).toBe(true);
    expect(getModuleMetadataVersion()).toBe(before + 1);
  });

  it('keeps partial merges, earlier snapshots, and class stores isolated', () => {
    // Given
    class Provider {}
    class Shared {}
    const empty = Module();
    @empty
    class First {}
    @empty
    class Second {}
    const previous = getModuleMetadata(First);
    const before = getModuleMetadataVersion();
    const addProviders = Module({ providers: [Provider], imports: [Shared] });

    // When
    addProviders(First, { kind: 'class', name: 'First', metadata: {}, addInitializer() {} });
    empty(First, { kind: 'class', name: 'First', metadata: {}, addInitializer() {} });

    // Then
    expect(getModuleMetadata(First)).toMatchObject({ providers: [Provider], imports: [Shared] });
    expect(previous?.providers).toBeUndefined();
    expect(getModuleMetadata(Second)?.providers).toBeUndefined();
    expect(getModuleMetadata(First)).not.toBe(getModuleMetadata(Second));
    expect(getModuleMetadataVersion()).toBe(before + 2);
  });

  it('preserves global metadata in either decorator order and on both sides of partial metadata', () => {
    // Given / When
    @Module({ global: true })
    @Module()
    class OuterGlobal {}
    @Module()
    @Module({ global: true })
    class InnerGlobal {}
    @Module()
    @Module({ exports: ['token'], providers: [{ provide: 'token', useValue: 1 }] })
    @Module(undefined)
    class Partial {}

    // Then
    expect(getModuleMetadata(OuterGlobal)?.global).toBe(true);
    expect(getModuleMetadata(InnerGlobal)).toEqual(getModuleMetadata(OuterGlobal));
    expect(getModuleMetadata(Partial)).toMatchObject({
      exports: ['token'],
      providers: [{ provide: 'token', useValue: 1 }],
    });
  });

  it('does not treat a null definition as empty metadata at application time', () => {
    const decorator = Reflect.apply(Module, undefined, [null]);
    expect(() => {
      @decorator
      class Invalid {}
      return Invalid;
    }).toThrow(TypeError);
  });
});
