import type { HttpApplicationAdapter } from '@fluojs/http';
import { HTTP_APPLICATION_ADAPTER } from '@fluojs/runtime/internal';
import {
  bootstrapNodeApplication as bootstrapRuntimeNodeApplication,
  NodeHttpApplicationAdapter,
} from '@fluojs/runtime/node';
import { afterEach } from 'vitest';

type GraphqlTestApplication = Awaited<ReturnType<typeof bootstrapRuntimeNodeApplication>>;

export function createGraphqlNetworkFixture(): {
  readonly bootstrapNodeApplication: (
    ...args: Parameters<typeof bootstrapRuntimeNodeApplication>
  ) => Promise<GraphqlTestApplication>;
  readonly findAvailablePort: () => Promise<number>;
  readonly resolvePort: (port: number) => Promise<number>;
} {
  const applications = new Set<GraphqlTestApplication>();

  afterEach(async () => {
    const activeApplications = Array.from(applications);
    applications.clear();
    await Promise.all(activeApplications.map(async (app) => await app.close()));
  });

  return {
    async bootstrapNodeApplication(...args): Promise<GraphqlTestApplication> {
      const app = await bootstrapRuntimeNodeApplication(...args);
      applications.add(app);
      return app;
    },
    async findAvailablePort(): Promise<number> {
      return 0;
    },
    async resolvePort(port: number): Promise<number> {
      if (port !== 0) {
        return port;
      }

      const app = Array.from(applications).at(-1);

      if (!app) {
        throw new Error('Expected a GraphQL test application to resolve its bound port.');
      }

      return await getBoundPort(app);
    },
  };
}

export async function getBoundPort(app: { get<T>(token: unknown): Promise<T> }): Promise<number> {
  const adapter = await app.get<HttpApplicationAdapter>(HTTP_APPLICATION_ADAPTER);

  if (!(adapter instanceof NodeHttpApplicationAdapter)) {
    throw new Error('Expected a Node HTTP application adapter.');
  }

  const address = adapter.getServer().address();

  if (!address || typeof address === 'string') {
    throw new Error('Expected the GraphQL test server to have a bound port.');
  }

  return address.port;
}
