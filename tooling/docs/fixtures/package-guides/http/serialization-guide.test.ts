import { serialize } from '@fluojs/serialization';
import { Test } from '@fluojs/testing';
import { describe, expect, it } from 'vitest';

import { SerializationAppModule, UserEntity } from './serialization-guide-app';

/**
 * Composition fixture for the Serialization package guide
 * (apps/docs/content/docs/packages/serialization.mdx).
 *
 * Two seams: the standalone engine (expose/exclude/transform, cycle cutting,
 * shared references) and the HTTP integration through SerializerInterceptor.
 */

describe('package-guides serialization engine', () => {
  it('strips excluded fields and applies transforms', () => {
    const user = new UserEntity();
    user.id = '1';
    user.username = 'fluo';
    user.passwordHash = '$2b$10$not-a-real-hash';

    expect(serialize(user)).toEqual({ id: '1', username: 'FLUO', role: 'member' });
  });

  it('cuts cyclic back edges to undefined', () => {
    const node: { id: string; self?: unknown } = { id: 'root' };
    node.self = node;

    const output = serialize(node) as { id: string; self?: unknown };
    expect(output.id).toBe('root');
    expect(output.self).toBeUndefined();
  });

  it('keeps completed shared references in the serialized graph', () => {
    const shared = { id: 's' };
    const graph = { x: shared, y: shared };

    const output = serialize(graph) as { x: { id: string }; y: { id: string } };
    expect(output.x).toEqual({ id: 's' });
    expect(output.y).toEqual({ id: 's' });
  });
});

describe('package-guides serialization interceptor', () => {
  it('shapes the uncommitted handler result and never exposes passwordHash', async () => {
    const app = await Test.createApp({ rootModule: SerializationAppModule });
    try {
      const response = await app.request('GET', '/users').send();

      expect(response.status).toBe(200);
      expect(response.body).toEqual([{ id: '1', username: 'FLUO', role: 'member' }]);
    } finally {
      await app.close();
    }
  });
});
