import type { HttpApplicationAdapter } from '@fluojs/http';
import { HTTP_APPLICATION_ADAPTER } from '@fluojs/runtime/internal';
import {
  bootstrapNodeApplication as bootstrapRuntimeNodeApplication,
  NodeHttpApplicationAdapter,
} from '@fluojs/runtime/node';
import { afterEach } from 'vitest';

type GraphqlTestApplication = Awaited<ReturnType<typeof bootstrapRuntimeNodeApplication>>;
type GraphqlTestApplications = Map<number, GraphqlTestApplication | undefined>;
type Closeable = { close: () => Promise<void> };

export function createGraphqlNetworkFixture(): {
  readonly bootstrapNodeApplication: (
    ...args: Parameters<typeof bootstrapRuntimeNodeApplication>
  ) => Promise<GraphqlTestApplication>;
  readonly findAvailablePort: () => Promise<number>;
  readonly resolvePort: (port: number) => Promise<number>;
} {
  const applications: GraphqlTestApplications = new Map();
  let nextPortToken = 10_000;

  afterEach(async () => {
    await closeGraphqlTestApplications(applications);
  });

  return {
    async bootstrapNodeApplication(rootModule, options): Promise<GraphqlTestApplication> {
      const token = options?.port;
      const app = await bootstrapRuntimeNodeApplication(
        rootModule,
        token !== undefined && applications.has(token) ? { ...options, port: 0 } : options,
      );

      if (token !== undefined && applications.has(token)) {
        applications.set(token, app);
      }

      return app;
    },
    async findAvailablePort(): Promise<number> {
      nextPortToken += 1;
      applications.set(nextPortToken, undefined);
      return nextPortToken;
    },
    async resolvePort(port: number): Promise<number> {
      const app = applications.get(port);

      if (!app) {
        throw new Error('Expected a GraphQL test application owned by its port token.');
      }

      return await getBoundPort(app);
    },
  };
}

export async function closeGraphqlTestApplications<T extends Closeable>(
  applications: Map<number, T | undefined>,
): Promise<void> {
  const owners = Array.from(applications.entries()).filter(
    (entry): entry is [number, T] => entry[1] !== undefined,
  );
  const results = await Promise.allSettled(owners.map(async ([, app]) => await app.close()));
  const errors: unknown[] = [];

  for (const [index, result] of results.entries()) {
    const [token] = owners[index]!;
    if (result.status === 'fulfilled') {
      applications.delete(token);
    } else {
      errors.push(result.reason);
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, 'Failed to close GraphQL test applications.');
  }
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
