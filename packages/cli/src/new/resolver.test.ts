import { describe, expect, it } from 'vitest';

import { DEFAULT_BOOTSTRAP_SCHEMA, resolveBootstrapPlan, resolveBootstrapSchema } from './resolver.js';

describe('resolveBootstrapSchema', () => {
  it('returns the shape-first compatibility baseline when no explicit schema is provided', () => {
    expect(resolveBootstrapSchema()).toEqual(DEFAULT_BOOTSTRAP_SCHEMA);
  });

  it('switches to the microservice starter defaults when shape=microservice is selected', () => {
    expect(resolveBootstrapSchema({ shape: 'microservice' })).toEqual({
      platform: 'none',
      runtime: 'node',
      shape: 'microservice',
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'tcp',
    });
  });
});

describe('resolveBootstrapPlan', () => {
  it('keeps the current fluo new default path on the Node + Fastify HTTP starter', () => {
    expect(resolveBootstrapPlan({ packageManager: 'pnpm' as const })).toEqual({
      dependencies: {
        dependencies: [
          '@fluojs/config',
          '@fluojs/core',
          '@fluojs/validation',
          '@fluojs/di',
          '@fluojs/http',
          '@fluojs/platform-fastify',
          '@fluojs/runtime',
        ],
        devDependencies: [
          '@fluojs/cli',
          '@fluojs/testing',
        ],
      },
      emitter: {
        platform: 'fastify',
        preset: 'standard',
        runtime: 'node',
        transport: 'http',
        type: 'http',
      },
      schema: DEFAULT_BOOTSTRAP_SCHEMA,
    });
  });

  it('accepts explicit HTTP shape flags without changing the compatibility baseline', () => {
    expect(resolveBootstrapPlan({
      packageManager: 'pnpm' as const,
      platform: 'fastify',
      runtime: 'node',
      shape: 'application',
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'http',
    })).toEqual(resolveBootstrapPlan({ packageManager: 'pnpm' as const }));
  });

  it('does not treat package-manager choice as runtime or platform selection', () => {
    const npmPlan = resolveBootstrapPlan({ packageManager: 'npm' as const });
    const bunPlan = resolveBootstrapPlan({ packageManager: 'bun' as const });

    expect(npmPlan.schema).toEqual(DEFAULT_BOOTSTRAP_SCHEMA);
    expect(bunPlan.schema).toEqual(DEFAULT_BOOTSTRAP_SCHEMA);
    expect(npmPlan.dependencies).toEqual(bunPlan.dependencies);
  });

  it('resolves the runnable TCP microservice starter as a first-class path', () => {
    expect(resolveBootstrapPlan({
      packageManager: 'pnpm' as const,
      shape: 'microservice',
    })).toEqual({
      dependencies: {
        dependencies: [
          '@fluojs/config',
          '@fluojs/core',
          '@fluojs/di',
          '@fluojs/microservices',
          '@fluojs/runtime',
        ],
        devDependencies: [
          '@fluojs/cli',
          '@fluojs/testing',
        ],
      },
      emitter: {
        platform: 'none',
        preset: 'standard',
        runtime: 'node',
        transport: 'tcp',
        type: 'microservice',
      },
      schema: {
        platform: 'none',
        runtime: 'node',
        shape: 'microservice',
        tooling: 'standard',
        topology: {
          deferred: true,
          mode: 'single-package',
        },
        transport: 'tcp',
      },
    });
  });

  it('rejects selecting the HTTP transport for the microservice shape', () => {
    expect(() => resolveBootstrapPlan({
      packageManager: 'pnpm' as const,
      platform: 'none',
      runtime: 'node',
      shape: 'microservice',
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'http',
    })).toThrow(
      'Unsupported bootstrap schema "microservice/node/http/none/standard/single-package". Microservice starters require a transport-aware microservice transport such as tcp, redis, nats, kafka, rabbitmq, mqtt, or grpc.',
    );
  });

  it('validates documented microservice transport families separately from the runnable starter path', () => {
    expect(() => resolveBootstrapPlan({
      packageManager: 'pnpm' as const,
      platform: 'none',
      runtime: 'node',
      shape: 'microservice',
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'kafka',
    })).toThrow(
      'Unsupported bootstrap schema "microservice/node/kafka/none/standard/single-package". The first-class microservice starter currently emits the runnable TCP starter, while transport validation recognizes the documented families: tcp, redis, redis-streams, nats, kafka, rabbitmq, mqtt, grpc.',
    );
  });

  it('rejects unsupported topology or runtime combinations until later issues extend the matrix', () => {
    expect(() => resolveBootstrapPlan({
      packageManager: 'pnpm' as const,
      runtime: 'node',
      shape: 'application',
      tooling: 'standard',
      topology: {
        deferred: false,
        mode: 'single-package',
      },
      transport: 'http',
      platform: 'fastify',
    })).toThrow(
      'Unsupported bootstrap schema "application/node/http/fastify/standard/single-package". The current compatibility baseline supports the standard single-package Node + Fastify HTTP starter and the TCP microservice starter.',
    );
  });
});
