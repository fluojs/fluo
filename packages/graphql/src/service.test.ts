import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphQLObjectType, GraphQLSchema, GraphQLString } from 'graphql';

import type { HttpApplicationAdapter } from '@fluojs/http';
import type { ApplicationLogger, CompiledModule } from '@fluojs/runtime';
import type { Container } from '@fluojs/di';

import { GraphqlLifecycleService } from './service.js';
import type { GraphqlModuleOptions } from './types.js';

function createService(options: GraphqlModuleOptions): GraphqlLifecycleService {
  const logger: ApplicationLogger = {
    debug() {},
    error() {},
    log() {},
    warn() {},
  };
  const adapter: HttpApplicationAdapter = {
    async close() {},
    async listen() {},
  };

  return new GraphqlLifecycleService(
    {} as unknown as Container,
    [] as CompiledModule[],
    logger,
    adapter,
    options,
  );
}

function createPortableSchema(): GraphQLSchema {
  return new GraphQLSchema({
    query: new GraphQLObjectType({
      fields: {
        ping: {
          resolve: () => 'pong',
          type: GraphQLString,
        },
      },
      name: 'Query',
    }),
  });
}

function resolveGraphiqlEnabled(service: GraphqlLifecycleService): boolean {
  const resolver = Reflect.get(service, 'resolveGraphiqlEnabled');

  if (typeof resolver !== 'function') {
    throw new Error('Expected resolveGraphiqlEnabled method to exist.');
  }

  return Reflect.apply(resolver, service, []) as boolean;
}

function resolveIntrospectionEnabled(service: GraphqlLifecycleService): boolean {
  const resolver = Reflect.get(service, 'resolveIntrospectionEnabled');

  if (typeof resolver !== 'function') {
    throw new Error('Expected resolveIntrospectionEnabled method to exist.');
  }

  return Reflect.apply(resolver, service, []) as boolean;
}

function resolveWebSocketLimits(service: GraphqlLifecycleService): {
  maxConnections: number;
  maxOperationsPerConnection: number;
  maxPayloadBytes: number;
} | undefined {
  const resolver = Reflect.get(service, 'resolveWebSocketLimits');

  if (typeof resolver !== 'function') {
    throw new Error('Expected resolveWebSocketLimits method to exist.');
  }

  return Reflect.apply(resolver, service, []) as {
    maxConnections: number;
    maxOperationsPerConnection: number;
    maxPayloadBytes: number;
  } | undefined;
}

describe('GraphqlLifecycleService graphiql defaults', () => {
  afterEach(() => {
    vi.doUnmock('node:module');
  });

  it('bootstraps portable HTTP and SSE paths without Node createRequire', async () => {
    vi.doMock('node:module', () => ({
      createRequire() {
        throw new Error('portable GraphQL HTTP/SSE bootstrap must not call createRequire.');
      },
    }));

    const service = createService({
      schema: createPortableSchema(),
    });

    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
    await service.onApplicationShutdown();
  });

  it('defaults to false when graphiql option is not set', () => {
    const service = createService({});

    expect(resolveGraphiqlEnabled(service)).toBe(false);
  });

  it('defaults to false regardless of NODE_ENV', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';

    try {
      const service = createService({});

      expect(resolveGraphiqlEnabled(service)).toBe(false);
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
  });

  it('respects explicit graphiql overrides', () => {
    const disabled = createService({ graphiql: false });
    const enabled = createService({ graphiql: true });

    expect(resolveGraphiqlEnabled(disabled)).toBe(false);
    expect(resolveGraphiqlEnabled(enabled)).toBe(true);
  });

  it('keeps introspection disabled by default', () => {
    const service = createService({});

    expect(resolveIntrospectionEnabled(service)).toBe(false);
  });

  it('enables introspection when graphiql is explicitly enabled', () => {
    const service = createService({ graphiql: true });

    expect(resolveIntrospectionEnabled(service)).toBe(true);
  });

  it('respects explicit introspection overrides', () => {
    const disabled = createService({ graphiql: true, introspection: false });
    const enabled = createService({ introspection: true });

    expect(resolveIntrospectionEnabled(disabled)).toBe(false);
    expect(resolveIntrospectionEnabled(enabled)).toBe(true);
  });

  it('uses conservative defaults for websocket limits when websocket transport is enabled', () => {
    const service = createService({
      subscriptions: {
        websocket: {
          enabled: true,
        },
      },
    });

    expect(resolveWebSocketLimits(service)).toEqual({
      maxConnections: 100,
      maxOperationsPerConnection: 25,
      maxPayloadBytes: 64 * 1024,
    });
  });

  it('respects explicit websocket limit overrides', () => {
    const service = createService({
      subscriptions: {
        websocket: {
          enabled: true,
          limits: {
            maxConnections: 5,
            maxOperationsPerConnection: 2,
            maxPayloadBytes: 4096,
          },
        },
      },
    });

    expect(resolveWebSocketLimits(service)).toEqual({
      maxConnections: 5,
      maxOperationsPerConnection: 2,
      maxPayloadBytes: 4096,
    });
  });

  it('allows opting out of websocket hardening budgets', () => {
    const service = createService({
      subscriptions: {
        websocket: {
          enabled: true,
          limits: false,
        },
      },
    });

    expect(resolveWebSocketLimits(service)).toBeUndefined();
  });
});
