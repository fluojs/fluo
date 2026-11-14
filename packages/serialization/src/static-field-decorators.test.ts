import { describe, expect, it, vi } from 'vitest';

import { Exclude, Expose, serialize, Transform } from './index.js';

describe('static field decorators', () => {
  const symbolKey = Symbol('token');

  it('serialize: static Expose on an expose-only class does not expose matching instance keys', () => {
    @Expose({ excludeExtraneous: true })
    class View {
      @Expose()
      static token = 'static';

      @Expose()
      static [symbolKey] = 'static-symbol';

      token = 'private';
      [symbolKey] = 'private-symbol';

      @Expose()
      id = 'public';
    }

    const serialized = serialize(new View());

    expect(serialized).toEqual({ id: 'public' });
    expect(View.token).toBe('static');
    expect(View[symbolKey]).toBe('static-symbol');
  });

  it('serialize: static Expose on a child preserves the inherited instance allowlist', () => {
    @Expose({ excludeExtraneous: true })
    class Base {
      @Expose()
      id = 'public';
    }

    @Expose()
    class Child extends Base {
      @Expose()
      static token = 'static';

      @Expose()
      static [symbolKey] = 'static-symbol';

      token = 'private';
      [symbolKey] = 'private-symbol';
    }

    const serialized = serialize(new Child());

    expect(serialized).toEqual({ id: 'public' });
    expect(Child.token).toBe('static');
    expect(Child[symbolKey]).toBe('static-symbol');
  });

  it('serialize: static-only Expose does not create phantom string or symbol output keys', () => {
    class View {
      @Expose()
      static token = 'static';

      @Expose()
      static [symbolKey] = 'static-symbol';
    }

    const serialized = serialize(new View());

    expect(serialized).toEqual({});
    expect(Reflect.ownKeys(serialized as object)).toEqual([]);
    expect(View.token).toBe('static');
    expect(View[symbolKey]).toBe('static-symbol');
  });

  it('serialize: static Expose on a base never exposes undecorated child instance fields', () => {
    @Expose({ excludeExtraneous: true })
    class Base {
      @Expose()
      static token = 'static';

      @Expose()
      static [symbolKey] = 'static-symbol';
    }

    class Child extends Base {
      token = 'private';
      [symbolKey] = 'private-symbol';
    }

    const serialized = serialize(new Child());

    expect(serialized).toEqual({});
    expect(Base.token).toBe('static');
    expect(Base[symbolKey]).toBe('static-symbol');
  });

  it.each(['Exclude', 'Transform'] as const)(
    'serialize: static %s leaves same-class instance string and symbol values unchanged',
    (kind: 'Exclude' | 'Transform') => {
      const callback = vi.fn(() => 'rewritten');
      const decorate = kind === 'Exclude' ? Exclude() : Transform(callback);

      class View {
        @decorate
        static token = 'static';

        @decorate
        static [symbolKey] = 'static-symbol';

        token = 'instance';
        [symbolKey] = 'instance-symbol';
      }

      const serialized = serialize(new View());

      expect(serialized).toEqual({ token: 'instance', [symbolKey]: 'instance-symbol' });
      expect(callback).not.toHaveBeenCalled();
      expect(View.token).toBe('static');
      expect(View[symbolKey]).toBe('static-symbol');
    },
  );

  it.each(['Expose', 'Exclude', 'Transform'] as const)(
    'serialize: static %s on a child preserves parent and sibling instance rules',
    (kind: 'Expose' | 'Exclude' | 'Transform') => {
      const callback = vi.fn(() => 'rewritten');
      const decorate = kind === 'Expose' ? Expose() : kind === 'Exclude' ? Exclude() : Transform(callback);
      const instanceTransform = vi.fn((value: unknown) => `${String(value)}B`);

      @Expose({ excludeExtraneous: true })
      class Base {
        @Expose()
        @Transform(instanceTransform)
        token = 'instance';

        @Expose()
        [symbolKey] = 'instance-symbol';

        @Exclude()
        secret = 'hidden';

        internal = 'private';
      }

      class Sibling extends Base {}
      const before = [serialize(new Base()), serialize(new Sibling())];

      class Child extends Base {
        @decorate
        static token = 'static';

        @decorate
        static [symbolKey] = 'static-symbol';

        @decorate
        static internal = 'static-internal';
      }

      const after = [serialize(new Base()), serialize(new Sibling()), serialize(new Child())];

      const expected = { token: 'instanceB', [symbolKey]: 'instance-symbol' };
      expect(before).toEqual([expected, expected]);
      expect(after).toEqual([expected, expected, expected]);
      expect(instanceTransform).toHaveBeenCalledTimes(5);
      expect(callback).not.toHaveBeenCalled();
      expect(Child.token).toBe('static');
      expect(Child[symbolKey]).toBe('static-symbol');
      expect(Child.internal).toBe('static-internal');
    },
  );

  it.each(['Expose', 'Exclude', 'Transform'] as const)(
    'serialize: static %s on a base preserves derived instance decorators and transform order',
    (kind: 'Expose' | 'Exclude' | 'Transform') => {
      const callback = vi.fn(() => 'rewritten');
      const decorate = kind === 'Expose' ? Expose() : kind === 'Exclude' ? Exclude() : Transform(callback);
      const calls: string[] = [];

      @Expose({ excludeExtraneous: true })
      class Base {
        @decorate
        static token = 'static';

        @decorate
        static [symbolKey] = 'static-symbol';

        @Transform((value) => {
          calls.push('base');
          return `${String(value)}B`;
        })
        token = 'instance';
      }

      class Child extends Base {
        @Expose()
        @Transform((value) => {
          calls.push('child');
          return `${String(value)}C`;
        })
        override token = 'instance';

        @Expose()
        [symbolKey] = 'instance-symbol';
      }

      const serialized = serialize(new Child());

      expect(serialized).toEqual({ token: 'instanceBC', [symbolKey]: 'instance-symbol' });
      expect(calls).toEqual(['base', 'child']);
      expect(callback).not.toHaveBeenCalled();
      expect(Base.token).toBe('static');
      expect(Base[symbolKey]).toBe('static-symbol');
    },
  );

  it('serialize: mixed static and instance decorators preserve instance exclusion and transform counts', () => {
    const callback = vi.fn(() => 'rewritten');
    const instanceTransform = vi.fn((value: unknown) => `${String(value)}!`);

    @Expose({ excludeExtraneous: true })
    class View {
      @Exclude()
      @Transform(callback)
      static token = 'static';

      @Expose()
      static [symbolKey] = 'static-symbol';

      @Expose()
      @Transform(instanceTransform)
      token = 'instance';

      @Expose()
      @Exclude()
      [symbolKey] = 'hidden';
    }

    const serialized = serialize(new View());

    expect(serialized).toEqual({ token: 'instance!' });
    expect(instanceTransform).toHaveBeenCalledTimes(1);
    expect(callback).not.toHaveBeenCalled();
    expect(View.token).toBe('static');
    expect(View[symbolKey]).toBe('static-symbol');
  });
});
