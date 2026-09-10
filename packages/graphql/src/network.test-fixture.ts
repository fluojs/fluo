import { createNodeTestApplication } from './test-support/application.js';
import type { HttpApplicationAdapter } from '@fluojs/http';
import { HTTP_APPLICATION_ADAPTER } from '@fluojs/runtime/internal';
import { NodeHttpApplicationAdapter } from '@fluojs/platform-nodejs';
import { afterEach } from 'vitest';

type GraphqlTestApplication = Awaited<ReturnType<typeof createNodeTestApplication>>;
type GraphqlTestApplications = Map<number, GraphqlTestApplication | undefined>;
type Closeable = { close: () => Promise<void> };

/**
 * Owns GraphQL test applications and maps logical port tokens to bound ports.
 * @returns Application creation, port-token allocation, and bound-port resolution helpers.
 */
export function createGraphqlNetworkFixture(): {
  readonly bootstrapNodeApplication: (
    ...args: Parameters<typeof createNodeTestApplication>
  ) => Promise<GraphqlTestApplication>;
  readonly findAvailablePort: () => Promise<number>;
  readonly resolvePort: (port: number) => Promise<number>;
} {
  const applications: GraphqlTestApplications = new Map();
  let nextPortToken = 65_535;

  afterEach(async () => {
    await closeGraphqlTestApplications(applications);
  });

  return {
    async bootstrapNodeApplication(rootModule, options): Promise<GraphqlTestApplication> {
      const token = options?.port;
      const app = await createNodeTestApplication(
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

/**
 * Closes every owned application while retaining failed owners for cleanup evidence.
 * @param applications Applications indexed by their logical port tokens.
 * @returns Completion after every close settles, or an aggregate of close failures.
 */
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

/**
 * Resolves the native port bound by a test application's Node adapter.
 * @param app Application exposing its registered HTTP adapter.
 * @returns The numeric port of the listening server.
 */
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
