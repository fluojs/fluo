import { describe, expect, it } from 'vitest';

import { Exclude } from './decorators/exclude.js';
import { Expose } from './decorators/expose.js';
import { Transform } from './decorators/transform.js';
import { Expose as PublicExpose, Transform as PublicTransform, serialize as publicSerialize } from './index.js';
import { serialize } from './serialize.js';

describe('serialize', () => {
  it('removes excluded fields from serialized output', () => {
    class UserView {
      id: string;

      @Exclude()
      password: string;

      constructor(id: string, password: string) {
        this.id = id;
        this.password = password;
      }
    }

    expect(serialize(new UserView('u-1', 'secret'))).toEqual({ id: 'u-1' });
  });

  it('keeps only exposed fields when excludeExtraneous is enabled', () => {
    @Expose({ excludeExtraneous: true })
    class UserView {
      @Expose()
      id: string;

      email: string;

      constructor(id: string, email: string) {
        this.id = id;
        this.email = email;
      }
    }

    expect(serialize(new UserView('u-1', 'u-1@example.com'))).toEqual({ id: 'u-1' });
  });

  it('applies transform functions before recursive serialization', () => {
    class UserView {
      @Transform((value) => String(value).toUpperCase())
      displayName: string;

      constructor(displayName: string) {
        this.displayName = displayName;
      }
    }

    expect(serialize(new UserView('fluo'))).toEqual({ displayName: 'FLUO' });
  });

  it('supports the documented public DTO population and value-only transform pattern', () => {
    type InternalPostRecord = {
      id: string;
      title: string;
      body: string;
      published: boolean;
    };

    @PublicExpose({ excludeExtraneous: true })
    class PublicPostDto {
      @PublicExpose()
      id = '';

      @PublicExpose()
      title = '';

      @PublicExpose()
      @PublicTransform((value) => String(value).trim())
      body = '';

      @PublicExpose()
      published = false;
    }

    const internalRecord: InternalPostRecord = {
      id: 'post-1',
      title: 'Intro',
      body: '  Hello fluo  ',
      published: true,
    };

    const dto = Object.assign(new PublicPostDto(), {
      id: internalRecord.id,
      title: internalRecord.title,
      body: internalRecord.body,
      published: internalRecord.published,
    });

    expect(publicSerialize(dto)).toEqual({
      id: 'post-1',
      title: 'Intro',
      body: 'Hello fluo',
      published: true,
    });
  });

  it('serializes nested metadata-bearing objects and arrays recursively', () => {
    class ProfileView {
      @Exclude()
      secret: string;

      nickname: string;

      constructor(nickname: string, secret: string) {
        this.nickname = nickname;
        this.secret = secret;
      }
    }

    class UserView {
      @Expose()
      profile: ProfileView;

      @Expose()
      profiles: ProfileView[];

      constructor(profile: ProfileView, profiles: ProfileView[]) {
        this.profile = profile;
        this.profiles = profiles;
      }
    }

    expect(
      serialize(
        new UserView(
          new ProfileView('alpha', 'hidden-1'),
          [new ProfileView('beta', 'hidden-2')],
        ),
      ),
    ).toEqual({
      profile: { nickname: 'alpha' },
      profiles: [{ nickname: 'beta' }],
    });
  });

  it('recurses into class instances without metadata so decorated child fields are respected', () => {
    class Inner {
      @Exclude()
      secret: string;

      public: string;

      constructor(secret: string, pub: string) {
        this.secret = secret;
        this.public = pub;
      }
    }

    class Outer {
      inner: Inner;

      constructor(inner: Inner) {
        this.inner = inner;
      }
    }

    const result = serialize(new Outer(new Inner('should-not-appear', 'visible'))) as {
      inner: Record<string, unknown>;
    };

    expect(result.inner.public).toBe('visible');
    expect(result.inner.secret).toBeUndefined();
  });

  it('does not alter plain objects without serialization metadata', () => {
    const plain = {
      id: 'p-1',
      nested: {
        ok: true,
      },
    };

    expect(serialize(plain)).toEqual(plain);
  });

  it('serializes cyclic object graphs into JSON-safe output', () => {
    class NodeView {
      @Expose()
      name: string;

      @Expose()
      next?: NodeView;

      constructor(name: string) {
        this.name = name;
      }
    }

    const root = new NodeView('root');
    root.next = root;
    const serialized = serialize(root) as { name: string; next?: unknown };

    expect(serialized.name).toBe('root');
    expect(serialized.next).toBeUndefined();
    expect(() => JSON.stringify(serialized)).not.toThrow();
  });

  it('preserves shared references instead of dropping revisited objects', () => {
    const shared = { id: 'shared-node' };
    const input = {
      first: shared,
      second: shared,
    };

    const serialized = serialize(input) as {
      first?: { id: string };
      second?: { id: string };
    };

    expect(serialized.first).toEqual({ id: 'shared-node' });
    expect(serialized.second).toEqual({ id: 'shared-node' });
    expect(serialized.second).toBe(serialized.first);
  });

  it('preserves shared decorated class-instance references across sibling fields', () => {
    class ProfileView {
      @Expose()
      id: string;

      @Exclude()
      secret: string;

      constructor(id: string, secret: string) {
        this.id = id;
        this.secret = secret;
      }
    }

    const shared = new ProfileView('shared-profile', 'hidden');
    const input = {
      first: shared,
      second: shared,
    };

    const serialized = serialize(input) as {
      first?: { id: string };
      second?: { id: string };
    };

    expect(serialized.first).toEqual({ id: 'shared-profile' });
    expect(serialized.second).toEqual({ id: 'shared-profile' });
    expect(serialized.second).toBe(serialized.first);
  });

  it('inherits base-class expose, exclude, and transform metadata on derived instances', () => {
    @Expose({ excludeExtraneous: true })
    class BaseView {
      @Expose()
      id: string;

      @Expose()
      @Transform((value) => String(value).toUpperCase())
      name: string;

      @Exclude()
      internalToken: string;

      constructor(id: string, name: string, internalToken: string) {
        this.id = id;
        this.name = name;
        this.internalToken = internalToken;
      }
    }

    class DerivedView extends BaseView {
      @Expose()
      role: string;

      constructor(id: string, name: string, internalToken: string, role: string) {
        super(id, name, internalToken);
        this.role = role;
      }
    }

    expect(serialize(new DerivedView('u-1', 'fluo', 'secret', 'admin'))).toEqual({
      id: 'u-1',
      name: 'FLUO',
      role: 'admin',
    });
  });

  it('serializes enumerable symbol-keyed properties in plain objects', () => {
    const token = Symbol('token');
    const input: Record<string | symbol, unknown> = {
      regular: 'value',
      [token]: { nested: true },
    };

    const serialized = serialize(input) as Record<string | symbol, unknown>;

    expect(serialized.regular).toBe('value');
    expect(serialized[token]).toEqual({ nested: true });
  });

  it('serializes null-prototype records without crashing', () => {
    const input = Object.create(null) as Record<string, unknown>;
    input.id = 'p-1';
    input.nested = Object.create(null) as Record<string, unknown>;
    (input.nested as Record<string, unknown>).ok = true;

    expect(serialize(input)).toEqual({
      id: 'p-1',
      nested: { ok: true },
    });
  });

  it('serializes own __proto__ keys as data without polluting output prototypes', () => {
    const input = { safe: true } as Record<string, unknown>;

    Object.defineProperty(input, '__proto__', {
      configurable: true,
      enumerable: true,
      value: {
        polluted: true,
      },
      writable: true,
    });

    const serialized = serialize(input) as Record<string, unknown>;

    expect(Object.keys(serialized)).toEqual(['safe', '__proto__']);
    expect(Object.getPrototypeOf(serialized)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(serialized, '__proto__')).toBe(true);
    expect(serialized.safe).toBe(true);
    expect(serialized.__proto__).toEqual({ polluted: true });
    expect((serialized as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('serializes exposed own __proto__ keys on decorated instances without prototype mutation', () => {
    @Expose({ excludeExtraneous: true })
    class DangerousView {
      @Expose()
      safe = true;

      @Expose()
      ['__proto__']!: Record<string, unknown>;

      constructor() {
        Object.defineProperty(this, '__proto__', {
          configurable: true,
          enumerable: true,
          value: {
            polluted: true,
          },
          writable: true,
        });
      }
    }

    const serialized = serialize(new DangerousView()) as Record<string, unknown>;

    expect(Object.keys(serialized)).toEqual(['safe', '__proto__']);
    expect(Object.getPrototypeOf(serialized)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(serialized, '__proto__')).toBe(true);
    expect(serialized.safe).toBe(true);
    expect(serialized.__proto__).toEqual({ polluted: true });
    expect((serialized as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('treats plain objects with unsafe constructor fields as plain records', () => {
    const input = {
      constructor: {
        danger: true,
      },
      nested: {
        constructor: 'still-data',
        ok: true,
      },
      ok: true,
    };

    expect(serialize(input)).toEqual(input);
  });

  it('keeps own prototype keys as plain data fields', () => {
    const input = {
      prototype: {
        safe: true,
      },
      nested: {
        prototype: 'still-data',
      },
    };

    const serialized = serialize(input) as {
      prototype: { safe: boolean };
      nested: { prototype: string };
    };

    expect(Object.getPrototypeOf(serialized)).toBe(Object.prototype);
    expect(serialized).toEqual(input);
  });

  it('preserves non-JSON leaf values instead of coercing them implicitly', () => {
    const createdAt = new Date('2026-03-24T00:00:00.000Z');
    const onSerialize = () => 'ok';
    const marker = Symbol.for('fluo.serialization.marker');
    const input = {
      createdAt,
      nested: {
        handler: onSerialize,
        marker,
      },
      total: 1n,
    };

    const serialized = serialize(input) as {
      createdAt: Date;
      nested: { handler: typeof onSerialize; marker: symbol };
      total: bigint;
    };

    expect(serialized.createdAt).toBe(createdAt);
    expect(serialized.nested.handler).toBe(onSerialize);
    expect(serialized.nested.marker).toBe(marker);
    expect(serialized.total).toBe(1n);
  });
});
