import { describe, expect, it } from 'vitest';

import type { HttpApplicationAdapter } from '@konekti/http';
import type { ApplicationLogger, CompiledModule } from '@konekti/runtime';
import type { Container } from '@konekti/di';

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

function resolveGraphiqlEnabled(service: GraphqlLifecycleService): boolean {
  const resolver = Reflect.get(service, 'resolveGraphiqlEnabled');

  if (typeof resolver !== 'function') {
    throw new Error('Expected resolveGraphiqlEnabled method to exist.');
  }

  return Reflect.apply(resolver, service, []) as boolean;
}

describe('GraphqlLifecycleService graphiql defaults', () => {
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
});
