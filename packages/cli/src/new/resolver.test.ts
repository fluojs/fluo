import { describe, expect, it } from 'vitest';

import { DEFAULT_BOOTSTRAP_SCHEMA, resolveBootstrapPlan, resolveBootstrapSchema } from './resolver.js';
import { STARTER_PROFILE_REGISTRY } from './starter-profiles.js';

function profileById(id: (typeof STARTER_PROFILE_REGISTRY)[number]['id']) {
  return STARTER_PROFILE_REGISTRY.find((profile) => profile.id === id)!;
}

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
  it('locks the shipped starter registry to the current fourteen supported matrix profiles', () => {
    expect(STARTER_PROFILE_REGISTRY.map((profile) => ({
      id: profile.id,
      schema: profile.schema,
    }))).toEqual([
      {
        id: 'application-bun-bun-http',
        schema: {
          platform: 'bun',
          runtime: 'bun',
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
        id: 'application-deno-deno-http',
        schema: {
          platform: 'deno',
          runtime: 'deno',
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
        id: 'application-cloudflare-workers-cloudflare-workers-http',
        schema: {
          platform: 'cloudflare-workers',
          runtime: 'cloudflare-workers',
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
        id: 'application-node-express-http',
        schema: {
          platform: 'express',
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
        id: 'application-node-nodejs-http',
        schema: {
          platform: 'nodejs',
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
        id: 'microservice-node-none-redis-streams',
        schema: {
          platform: 'none',
          runtime: 'node',
          shape: 'microservice',
          tooling: 'standard',
          topology: {
            deferred: true,
            mode: 'single-package',
          },
          transport: 'redis-streams',
        },
      },
      {
        id: 'microservice-node-none-mqtt',
        schema: {
          platform: 'none',
          runtime: 'node',
          shape: 'microservice',
          tooling: 'standard',
          topology: {
            deferred: true,
            mode: 'single-package',
          },
          transport: 'mqtt',
        },
      },
      {
        id: 'microservice-node-none-grpc',
        schema: {
          platform: 'none',
          runtime: 'node',
          shape: 'microservice',
          tooling: 'standard',
          topology: {
            deferred: true,
            mode: 'single-package',
          },
          transport: 'grpc',
        },
      },
      {
        id: 'microservice-node-none-nats',
        schema: {
          platform: 'none',
          runtime: 'node',
          shape: 'microservice',
          tooling: 'standard',
          topology: {
            deferred: true,
            mode: 'single-package',
          },
          transport: 'nats',
        },
      },
      {
        id: 'microservice-node-none-kafka',
        schema: {
          platform: 'none',
          runtime: 'node',
          shape: 'microservice',
          tooling: 'standard',
          topology: {
            deferred: true,
            mode: 'single-package',
          },
          transport: 'kafka',
        },
      },
      {
        id: 'microservice-node-none-rabbitmq',
        schema: {
          platform: 'none',
          runtime: 'node',
          shape: 'microservice',
          tooling: 'standard',
          topology: {
            deferred: true,
            mode: 'single-package',
          },
          transport: 'rabbitmq',
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
      profile: profileById('application-node-fastify-http'),
      schema: DEFAULT_BOOTSTRAP_SCHEMA,
    });
  });

  it('resolves the Bun application starter as a first-class HTTP path', () => {
    expect(resolveBootstrapPlan({
      packageManager: 'pnpm' as const,
      runtime: 'bun',
      shape: 'application',
    })).toEqual({
      dependencies: {
        dependencies: [
          '@fluojs/config',
          '@fluojs/core',
          '@fluojs/validation',
          '@fluojs/di',
          '@fluojs/http',
          '@fluojs/platform-bun',
          '@fluojs/runtime',
        ],
        devDependencies: [
          '@fluojs/cli',
          '@fluojs/testing',
        ],
      },
      emitter: {
        platform: 'bun',
        preset: 'standard',
        runtime: 'bun',
        transport: 'http',
        type: 'http',
      },
      profile: profileById('application-bun-bun-http'),
      schema: {
        platform: 'bun',
        runtime: 'bun',
        shape: 'application',
        tooling: 'standard',
        topology: {
          deferred: true,
          mode: 'single-package',
        },
        transport: 'http',
      },
    });
  });

  it('resolves the Deno application starter as a first-class HTTP path', () => {
    expect(resolveBootstrapPlan({
      packageManager: 'pnpm' as const,
      runtime: 'deno',
      shape: 'application',
    })).toEqual({
      dependencies: {
        dependencies: [
          '@fluojs/config',
          '@fluojs/core',
          '@fluojs/validation',
          '@fluojs/di',
          '@fluojs/http',
          '@fluojs/platform-deno',
          '@fluojs/runtime',
        ],
        devDependencies: [
          '@fluojs/cli',
        ],
      },
      emitter: {
        platform: 'deno',
        preset: 'standard',
        runtime: 'deno',
        transport: 'http',
        type: 'http',
      },
      profile: profileById('application-deno-deno-http'),
      schema: {
        platform: 'deno',
        runtime: 'deno',
        shape: 'application',
        tooling: 'standard',
        topology: {
          deferred: true,
          mode: 'single-package',
        },
        transport: 'http',
      },
    });
  });

  it('resolves the Cloudflare Workers application starter as a first-class HTTP path', () => {
    expect(resolveBootstrapPlan({
      packageManager: 'pnpm' as const,
      runtime: 'cloudflare-workers',
      shape: 'application',
    })).toEqual({
      dependencies: {
        dependencies: [
          '@fluojs/core',
          '@fluojs/validation',
          '@fluojs/di',
          '@fluojs/http',
          '@fluojs/platform-cloudflare-workers',
          '@fluojs/runtime',
        ],
        devDependencies: [
          '@fluojs/cli',
          '@fluojs/testing',
        ],
      },
      emitter: {
        platform: 'cloudflare-workers',
        preset: 'standard',
        runtime: 'cloudflare-workers',
        transport: 'http',
        type: 'http',
      },
      profile: profileById('application-cloudflare-workers-cloudflare-workers-http'),
      schema: {
        platform: 'cloudflare-workers',
        runtime: 'cloudflare-workers',
        shape: 'application',
        tooling: 'standard',
        topology: {
          deferred: true,
          mode: 'single-package',
        },
        transport: 'http',
      },
    });
  });

  it('accepts explicit Fastify HTTP shape flags without changing the compatibility baseline', () => {
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

  it('resolves the Express application starter as a first-class HTTP path', () => {
    expect(resolveBootstrapPlan({
      packageManager: 'pnpm' as const,
      platform: 'express',
      shape: 'application',
    })).toEqual({
      dependencies: {
        dependencies: [
          '@fluojs/config',
          '@fluojs/core',
          '@fluojs/validation',
          '@fluojs/di',
          '@fluojs/http',
          '@fluojs/platform-express',
          '@fluojs/runtime',
        ],
        devDependencies: [
          '@fluojs/cli',
          '@fluojs/testing',
        ],
      },
      emitter: {
        platform: 'express',
        preset: 'standard',
        runtime: 'node',
        transport: 'http',
        type: 'http',
      },
      profile: profileById('application-node-express-http'),
      schema: {
        platform: 'express',
        runtime: 'node',
        shape: 'application',
        tooling: 'standard',
        topology: {
          deferred: true,
          mode: 'single-package',
        },
        transport: 'http',
      },
    });
  });

  it('resolves the raw Node.js application starter as a first-class HTTP path', () => {
    expect(resolveBootstrapPlan({
      packageManager: 'pnpm' as const,
      platform: 'nodejs',
      shape: 'application',
    })).toEqual({
      dependencies: {
        dependencies: [
          '@fluojs/config',
          '@fluojs/core',
          '@fluojs/validation',
          '@fluojs/di',
          '@fluojs/http',
          '@fluojs/platform-nodejs',
          '@fluojs/runtime',
        ],
        devDependencies: [
          '@fluojs/cli',
          '@fluojs/testing',
        ],
      },
      emitter: {
        platform: 'nodejs',
        preset: 'standard',
        runtime: 'node',
        transport: 'http',
        type: 'http',
      },
      profile: profileById('application-node-nodejs-http'),
      schema: {
        platform: 'nodejs',
        runtime: 'node',
        shape: 'application',
        tooling: 'standard',
        topology: {
          deferred: true,
          mode: 'single-package',
        },
        transport: 'http',
      },
    });
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
      profile: profileById('microservice-node-none-tcp'),
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

  it('resolves the Redis Streams microservice starter as a first-class path', () => {
    expect(resolveBootstrapPlan({
      packageManager: 'pnpm' as const,
      platform: 'none',
      shape: 'microservice',
      transport: 'redis-streams',
    })).toEqual({
      dependencies: {
        dependencies: [
          '@fluojs/config',
          '@fluojs/core',
          '@fluojs/di',
          '@fluojs/microservices',
          '@fluojs/runtime',
          'ioredis',
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
        transport: 'redis-streams',
        type: 'microservice',
      },
      profile: profileById('microservice-node-none-redis-streams'),
      schema: {
        platform: 'none',
        runtime: 'node',
        shape: 'microservice',
        tooling: 'standard',
        topology: {
          deferred: true,
          mode: 'single-package',
        },
        transport: 'redis-streams',
      },
    });
  });

  it('resolves the MQTT microservice starter as a first-class path', () => {
    expect(resolveBootstrapPlan({
      packageManager: 'pnpm' as const,
      platform: 'none',
      shape: 'microservice',
      transport: 'mqtt',
    })).toEqual({
      dependencies: {
        dependencies: [
          '@fluojs/config',
          '@fluojs/core',
          '@fluojs/di',
          '@fluojs/microservices',
          '@fluojs/runtime',
          'mqtt',
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
        transport: 'mqtt',
        type: 'microservice',
      },
      profile: profileById('microservice-node-none-mqtt'),
      schema: {
        platform: 'none',
        runtime: 'node',
        shape: 'microservice',
        tooling: 'standard',
        topology: {
          deferred: true,
          mode: 'single-package',
        },
        transport: 'mqtt',
      },
    });
  });

  it('resolves the gRPC microservice starter as a first-class path', () => {
    expect(resolveBootstrapPlan({
      packageManager: 'pnpm' as const,
      platform: 'none',
      shape: 'microservice',
      transport: 'grpc',
    })).toEqual({
      dependencies: {
        dependencies: [
          '@fluojs/config',
          '@fluojs/core',
          '@fluojs/di',
          '@fluojs/microservices',
          '@fluojs/runtime',
          '@grpc/grpc-js',
          '@grpc/proto-loader',
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
        transport: 'grpc',
        type: 'microservice',
      },
      profile: profileById('microservice-node-none-grpc'),
      schema: {
        platform: 'none',
        runtime: 'node',
        shape: 'microservice',
        tooling: 'standard',
        topology: {
          deferred: true,
          mode: 'single-package',
        },
        transport: 'grpc',
      },
    });
  });

  it('resolves the NATS microservice starter as a first-class path', () => {
    expect(resolveBootstrapPlan({
      packageManager: 'pnpm' as const,
      platform: 'none',
      shape: 'microservice',
      transport: 'nats',
    })).toEqual({
      dependencies: {
        dependencies: [
          '@fluojs/config',
          '@fluojs/core',
          '@fluojs/di',
          '@fluojs/microservices',
          '@fluojs/runtime',
          'nats',
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
        transport: 'nats',
        type: 'microservice',
      },
      profile: profileById('microservice-node-none-nats'),
      schema: {
        platform: 'none',
        runtime: 'node',
        shape: 'microservice',
        tooling: 'standard',
        topology: {
          deferred: true,
          mode: 'single-package',
        },
        transport: 'nats',
      },
    });
  });

  it('resolves the Kafka microservice starter as a first-class path', () => {
    expect(resolveBootstrapPlan({
      packageManager: 'pnpm' as const,
      platform: 'none',
      shape: 'microservice',
      transport: 'kafka',
    })).toEqual({
      dependencies: {
        dependencies: [
          '@fluojs/config',
          '@fluojs/core',
          '@fluojs/di',
          '@fluojs/microservices',
          '@fluojs/runtime',
          'kafkajs',
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
        transport: 'kafka',
        type: 'microservice',
      },
      profile: profileById('microservice-node-none-kafka'),
      schema: {
        platform: 'none',
        runtime: 'node',
        shape: 'microservice',
        tooling: 'standard',
        topology: {
          deferred: true,
          mode: 'single-package',
        },
        transport: 'kafka',
      },
    });
  });

  it('resolves the RabbitMQ microservice starter as a first-class path', () => {
    expect(resolveBootstrapPlan({
      packageManager: 'pnpm' as const,
      platform: 'none',
      shape: 'microservice',
      transport: 'rabbitmq',
    })).toEqual({
      dependencies: {
        dependencies: [
          '@fluojs/config',
          '@fluojs/core',
          '@fluojs/di',
          '@fluojs/microservices',
          '@fluojs/runtime',
          'amqplib',
        ],
        devDependencies: [
          '@fluojs/cli',
          '@fluojs/testing',
          '@types/amqplib',
        ],
      },
      emitter: {
        platform: 'none',
        preset: 'standard',
        runtime: 'node',
        transport: 'rabbitmq',
        type: 'microservice',
      },
      profile: profileById('microservice-node-none-rabbitmq'),
      schema: {
        platform: 'none',
        runtime: 'node',
        shape: 'microservice',
        tooling: 'standard',
        topology: {
          deferred: true,
          mode: 'single-package',
        },
        transport: 'rabbitmq',
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
      profile: profileById('mixed-node-fastify-tcp'),
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
      'Unsupported bootstrap schema "microservice/node/http/none/standard/single-package". Microservice starters require a transport-aware microservice transport such as tcp, redis-streams, mqtt, grpc, nats, kafka, or rabbitmq.',
    );
  });

  it('rejects application transport expansion outside the HTTP starter matrix', () => {
    expect(() => resolveBootstrapPlan({
      packageManager: 'pnpm' as const,
      platform: 'fastify',
      runtime: 'node',
      shape: 'application',
      tooling: 'standard',
      topology: {
        deferred: true,
        mode: 'single-package',
      },
      transport: 'tcp',
    })).toThrow(
      'Unsupported bootstrap schema "application/node/tcp/fastify/standard/single-package". Application starters currently require the HTTP transport across the Fastify, Express, raw Node.js, Bun, Deno, and Cloudflare Workers starter profiles.',
    );
  });

  it('rejects transport values outside the shipped starter matrix during schema resolution', () => {
    expect(() => resolveBootstrapSchema({ transport: 'redis' as never })).toThrow(
      'Unsupported transport "redis". Supported values: http, tcp, redis-streams, nats, kafka, rabbitmq, mqtt, grpc.',
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
      'Unsupported bootstrap schema "application/node/http/fastify/standard/single-package". The current compatibility baseline supports the standard single-package Node + Fastify/Express/raw Node.js HTTP starters, Bun/Deno/Cloudflare Workers HTTP starters, the tcp/redis-streams/nats/kafka/rabbitmq/mqtt/grpc microservice starters, and the mixed single-package starter.',
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
      'Unsupported bootstrap schema "mixed/node/tcp/fastify/standard/single-package". The current compatibility baseline supports the standard single-package Node + Fastify/Express/raw Node.js HTTP starters, Bun/Deno/Cloudflare Workers HTTP starters, the tcp/redis-streams/nats/kafka/rabbitmq/mqtt/grpc microservice starters, and the mixed single-package starter.',
    );
  });
});
