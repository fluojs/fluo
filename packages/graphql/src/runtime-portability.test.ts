import { readFileSync } from 'node:fs';

import { bootstrapBunApplication, createBunFetchHandler } from '@fluojs/platform-bun';
import {
  bootstrapCloudflareWorkerApplication,
  type CloudflareWorkerExecutionContext,
} from '@fluojs/platform-cloudflare-workers';
import { bootstrapDenoApplication, createDenoFetchHandler } from '@fluojs/platform-deno';
import { defineModule, type ModuleType } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { GraphqlModule, Query, Resolver, Subscription } from './index.js';

interface PortableGraphqlApplication {
  close(): Promise<void>;
  dispatch(request: Request): Promise<Response>;
}

interface RuntimeTarget {
  readonly bootstrap: (rootModule: ModuleType) => Promise<PortableGraphqlApplication>;
  readonly name: string;
}

@Resolver()
class RuntimePortabilityResolver {
  @Query()
  runtime(): string {
    return 'portable';
  }

  @Subscription()
  async *runtimeEvents(): AsyncGenerator<string, void, void> {
    yield 'portable-sse';
  }
}

function createRootModule(): ModuleType {
  class AppModule {}

  return defineModule(AppModule, {
    imports: [
      GraphqlModule.forRoot({
        resolvers: [RuntimePortabilityResolver],
      }),
    ],
    providers: [RuntimePortabilityResolver],
  });
}

const runtimeTargets: readonly RuntimeTarget[] = [
  {
    name: 'Bun',
    async bootstrap(rootModule) {
      const app = await bootstrapBunApplication(rootModule, { cors: false });
      const dispatch = createBunFetchHandler({ dispatcher: app.dispatcher });

      return {
        close: () => app.close(),
        dispatch: async (request) => await dispatch(request),
      };
    },
  },
  {
    name: 'Deno',
    async bootstrap(rootModule) {
      const app = await bootstrapDenoApplication(rootModule, { cors: false });
      const dispatch = createDenoFetchHandler({ dispatcher: app.dispatcher });

      return {
        close: () => app.close(),
        dispatch: async (request) => await dispatch(request),
      };
    },
  },
  {
    name: 'Cloudflare Workers',
    async bootstrap(rootModule) {
      const worker = await bootstrapCloudflareWorkerApplication(rootModule, { cors: false });
      const executionContext: CloudflareWorkerExecutionContext = {
        waitUntil() {},
      };

      return {
        close: () => worker.close(),
        dispatch: (request) => worker.fetch(request, {}, executionContext),
      };
    },
  },
];

describe('@fluojs/graphql runtime support metadata', () => {
  it('does not declare a Node.js engine when portable runtimes are supported', () => {
    const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');

    expect(manifest).not.toMatch(/"engines"\s*:\s*\{\s*"node"/u);
  });
});

describe.each(runtimeTargets)('$name GraphQL portability', ({ bootstrap }) => {
  it('executes GraphQL queries through the runtime HTTP adapter', async () => {
    const app = await bootstrap(createRootModule());

    try {
      const response = await app.dispatch(
        new Request('https://runtime.test/graphql', {
          body: JSON.stringify({ query: '{ runtime }' }),
          headers: { 'content-type': 'application/json' },
          method: 'POST',
        }),
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ data: { runtime: 'portable' } });
    } finally {
      await app.close();
    }
  });

  it('streams GraphQL subscriptions through the runtime SSE adapter', async () => {
    const app = await bootstrap(createRootModule());

    try {
      const query = encodeURIComponent('subscription { runtimeEvents }');
      const response = await app.dispatch(
        new Request(`https://runtime.test/graphql?query=${query}`, {
          headers: { accept: 'text/event-stream' },
        }),
      );

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/event-stream');
      await expect(response.text()).resolves.toContain('"runtimeEvents":"portable-sse"');
    } finally {
      await app.close();
    }
  });
});
