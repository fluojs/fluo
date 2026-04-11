import { describe, expect, it } from 'vitest';

import { DEFAULT_BOOTSTRAP_SCHEMA, resolveBootstrapPlan, resolveBootstrapSchema } from './resolver.js';
import { STARTER_PROFILE_REGISTRY } from './starter-profiles.js';

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

  it('switches to the mixed starter defaults when shape=mixed is selected', () => {
    expect(resolveBootstrapSchema({ shape: 'mixed' })).toEqual({
      platform: 'fastify',
      runtime: 'node',
      shape: 'mixed',
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
  it('locks the shipped starter registry to the current three supported matrix profiles', () => {
    expect(STARTER_PROFILE_REGISTRY.map((profile) => ({
      id: profile.id,
      schema: profile.schema,
    }))).toEqual([
      {
        id: 'application-node-fastify-http',
        schema: {
          platform: 'fastify',
          runtime: 'node',
          shape: 'application',
          tooling: 'standard',
          topology: {
            deferred: true,
            mode: 'single-package',
          },
          transport: 'http',
        },
      },
      {
        id: 'microservice-node-none-tcp',
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
      },
      {
        id: 'mixed-node-fastify-tcp',
        schema: {
          platform: 'fastify',
          runtime: 'node',
          shape: 'mixed',
          tooling: 'standard',
          topology: {
            deferred: true,
            mode: 'single-package',
          },
          transport: 'tcp',
        },
      },
    ]);
  });

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
      profile: STARTER_PROFILE_REGISTRY[0],
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
      profile: STARTER_PROFILE_REGISTRY[1],
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

  it('resolves the mixed starter as one HTTP app with an attached TCP microservice', () => {
    expect(resolveBootstrapPlan({
      packageManager: 'pnpm' as const,
      shape: 'mixed',
    })).toEqual({
      dependencies: {
        dependencies: [
          '@fluojs/config',
          '@fluojs/core',
          '@fluojs/validation',
          '@fluojs/di',
          '@fluojs/http',
          '@fluojs/microservices',
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
        transport: 'tcp',
        type: 'mixed',
      },
      profile: STARTER_PROFILE_REGISTRY[2],
      schema: {
        platform: 'fastify',
        runtime: 'node',
        shape: 'mixed',
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

  it('rejects unsupported mixed transports while keeping the mixed contract narrow', () => {
    expect(() => resolveBootstrapPlan({
      packageManager: 'pnpm' as const,
      platform: 'fastify',
      runtime: 'node',
      shape: 'mixed',
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'kafka',
    })).toThrow(
      'Unsupported bootstrap schema "mixed/node/kafka/fastify/standard/single-package". The first mixed starter currently supports only the attached TCP microservice contract.',
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
      'Unsupported bootstrap schema "application/node/http/fastify/standard/single-package". The current compatibility baseline supports the standard single-package Node + Fastify HTTP starter, the TCP microservice starter, and the mixed single-package starter.',
    );
  });

  it('rejects unsupported mixed topology expansions until a later issue adds them', () => {
    expect(() => resolveBootstrapPlan({
      packageManager: 'pnpm' as const,
      platform: 'fastify',
      runtime: 'node',
      shape: 'mixed',
      tooling: 'standard',
      topology: {
        deferred: false,
        mode: 'single-package',
      },
      transport: 'tcp',
    })).toThrow(
      'Unsupported bootstrap schema "mixed/node/tcp/fastify/standard/single-package". The current compatibility baseline supports the standard single-package Node + Fastify HTTP starter, the TCP microservice starter, and the mixed single-package starter.',
    );
  });
});
