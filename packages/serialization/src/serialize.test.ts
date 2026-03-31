import { describe, expect, it } from 'vitest';

import { Exclude } from './decorators/exclude.js';
import { Expose } from './decorators/expose.js';
import { Transform } from './decorators/transform.js';
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

    expect(serialize(new UserView('konekti'))).toEqual({ displayName: 'KONEKTI' });
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
});
