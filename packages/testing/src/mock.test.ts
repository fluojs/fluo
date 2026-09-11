import { describe, expect, it, vi } from 'vitest';
import * as mockApi from './mock.js';
import { asMock, PrototypeMock, ShallowMock } from './mock.js';

describe('mock factory contracts', () => {
  it('owns each factory on its class without legacy aliases', () => {
    expect(Object.hasOwn(ShallowMock, 'create')).toBe(true);
    expect(Object.hasOwn(PrototypeMock, 'create')).toBe(true);
    expect('createMock' in mockApi).toBe(false);
    expect('createDeepMock' in mockApi).toBe(false);
  });

  it('creates stable shallow spies without mocking nested manual fakes', async () => {
    const nested = { read: () => 'manual' };
    const supplied = vi.fn<(id: string) => Promise<string>>().mockResolvedValue('supplied');
    const symbol = Symbol('method');
    interface Service {
      nested: typeof nested;
      supplied(id: string): Promise<string>;
      generated(id: number): number;
      [symbol](): string;
    }
    const mock = ShallowMock.create<Service>({ nested, supplied });
    expect(mock.nested).toBe(nested);
    expect(mock.nested.read()).toBe('manual');
    expect(vi.isMockFunction(mock.nested.read)).toBe(false);
    expect(mock.supplied).toBe(supplied);
    await expect(mock.supplied('id')).resolves.toBe('supplied');
    expect(mock.generated).toBe(mock.generated);
    mock.generated.mockReturnValueOnce(4).mockReturnValue(5);
    expect(mock.generated(1)).toBe(4);
    expect(mock.generated(2)).toBe(5);
    expect(mock.generated.mock.calls).toEqual([[1], [2]]);
    mock.generated.mockClear();
    expect(mock.generated.mock.calls).toEqual([]);
    expect(vi.isMockFunction(mock[symbol])).toBe(true);
    expect(mock[symbol]).toBe(mock[symbol]);
    expect(mock[symbol]()).toBeUndefined();
  });

  it('keeps explicit undefined values and rejects missing members in strict mode', () => {
    const mock = ShallowMock.create<{ value: string | undefined; missing(): void }>(
      { value: undefined },
      { strict: true },
    );
    expect(mock.value).toBeUndefined();
    expect(() => mock.missing).toThrow(Error);
  });

  it('does not infer missing data properties or recursively mock return values', () => {
    const mock = ShallowMock.create<{ nested: { read(): void }; load(): { read(): void } }>();
    expect(vi.isMockFunction(mock.nested)).toBe(true);
    expect(mock.load()).toBeUndefined();
  });

  it('mocks only prototype methods without constructing instances or executing accessors', () => {
    const constructor = vi.fn();
    const getter = vi.fn();
    const symbol = Symbol('method');
    class Base {
      inherited() { return 'base'; }
      toString() { return 'base'; }
      [symbol]() { return 1; }
    }
    class Service extends Base {
      nested = { read: () => 'real' };
      arrow = () => 'real';
      constructor(_required: string) { super(); constructor(); }
      get accessor() { getter(); return 'real'; }
      method(_id: string) { return 'real'; }
      override inherited() { return 'child'; }
    }
    const mock = PrototypeMock.create(Service);
    expect(constructor).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
    expect(mock.nested).toBeUndefined();
    expect(mock.arrow).toBeUndefined();
    expect(mock.accessor).toBeUndefined();
    expect(Reflect.ownKeys(mock)).toEqual(['method', 'inherited', 'toString', symbol]);
    expect(vi.isMockFunction(mock.toString)).toBe(true);
    expect(vi.isMockFunction(mock.inherited)).toBe(true);
    expect(vi.isMockFunction(mock[symbol])).toBe(true);
    expect(mock.method('id')).toBeUndefined();
    mock.method.mockReturnValue('fake');
    expect(mock.method('next')).toBe('fake');
    expect(mock.method.mock.calls).toEqual([['id'], ['next']]);
    expect(mock).not.toBeInstanceOf(Service);
    expect(PrototypeMock.create(Service).method).not.toBe(mock.method);
  });

  it('does not resurrect base methods shadowed by a non-method descriptor', () => {
    class Base { method() { return 'real'; } }
    class Child extends Base {}
    Object.defineProperty(Child.prototype, 'method', { get: () => { throw new Error('not executed'); } });
    expect(Object.hasOwn(PrototypeMock.create(Child), 'method')).toBe(false);
  });

  it('keeps asMock a function-only Vitest narrowing without wrapping the function', () => {
    const fn = vi.fn<(id: string) => number>().mockReturnValue(1);
    const typed = asMock(fn as (id: string) => number);
    expect(typed).toBe(fn);
    typed.mockReturnValue(2);
    expect(typed('id')).toBe(2);
    expect(typed.mock.calls).toEqual([['id']]);
  });
});
