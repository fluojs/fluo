import type { AddressInfo } from 'node:net';
import { createServer } from 'node:net';

import { NodeHttpApplicationAdapter } from '@fluojs/platform-nodejs';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { GraphqlAppModule } from './graphql-guide-app';

/**
 * Composition fixture for the GraphQL package guide
 * (apps/docs/content/docs/packages/graphql.mdx).
 *
 * Boots the guide application through the native Node HTTP adapter — the same
 * composition a production app uses — and asserts JSON responses from the fixed
 * /graphql endpoint, including the BAD_USER_INPUT mapping for failed DTO rules
 * and the operation-scoped isolation of the request-scoped MessageStore.
 */

async function findAvailablePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

async function postGraphql(port: number, query: string): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${String(port)}/graphql`, {
    body: JSON.stringify({ query }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });

  return response.json();
}

interface GraphQLErrorShape {
  data: Record<string, unknown>;
  errors?: Array<{ extensions?: { code?: string; issues?: Array<{ field?: string }> } }>;
}

describe('package-guides graphql composition', () => {
  it('answers queries and maps validation failures to BAD_USER_INPUT', async () => {
    const port = await findAvailablePort();
    const app = await FluoFactory.create(GraphqlAppModule, {
      adapter: NodeHttpApplicationAdapter.create({ host: '127.0.0.1', port }),
    });

    try {
      await app.listen();

      await expect(postGraphql(port, '{ echo(value: "hello") }')).resolves.toEqual({
        data: { echo: 'echo: hello' },
      });

      const invalid = (await postGraphql(port, '{ echo(value: "x") }')) as GraphQLErrorShape;
      expect(invalid.errors?.[0]?.extensions?.code).toBe('BAD_USER_INPUT');
      expect(invalid.errors?.[0]?.extensions?.issues?.[0]?.field).toBe('value');
      expect(invalid.data.echo).toBeNull();

      await expect(postGraphql(port, 'mutation { setMessage(message: "hi") }')).resolves.toEqual({
        data: { setMessage: 'hi' },
      });

      // A new HTTP request is a new operation container, so the request-scoped
      // MessageStore starts fresh instead of observing the mutation above.
      await expect(postGraphql(port, '{ currentMessage }')).resolves.toEqual({
        data: { currentMessage: 'initial' },
      });
    } finally {
      await app.close();
    }
  });
});
