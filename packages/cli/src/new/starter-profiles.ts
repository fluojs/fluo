import type {
  BootstrapPlatform,
  BootstrapRuntime,
  BootstrapSchema,
  BootstrapShape,
  BootstrapToolingPreset,
  BootstrapTopology,
  BootstrapTransport,
} from './types.js';

/** Emitter families that decide which scaffold template tree renders the starter. */
export type StarterEmitterType = 'http' | 'microservice' | 'mixed';
/** Stable IDs for the scaffold recipes currently shipped by `fluo new`. */
export type StarterScaffoldRecipeId =
  | 'application-bun-bun-http'
  | 'application-cloudflare-workers-cloudflare-workers-http'
  | 'application-deno-deno-http'
  | 'application-node-express-http'
  | 'application-node-fastify-http'
  | 'application-node-nodejs-http'
  | 'microservice-node-none-grpc'
  | 'microservice-node-none-kafka'
  | 'microservice-node-none-mqtt'
  | 'microservice-node-none-nats'
  | 'microservice-node-none-rabbitmq'
  | 'microservice-node-none-redis-streams'
  | 'microservice-node-none-tcp'
  | 'mixed-node-fastify-tcp';

type StarterDependencies = {
  dependencies: readonly string[];
  devDependencies: readonly string[];
};

/** Fully resolved starter metadata used by schema resolution, prompts, and scaffold emission. */
export interface StarterProfile {
  dependencies: StarterDependencies;
  emitter: {
    platform: BootstrapPlatform;
    preset: BootstrapToolingPreset;
    runtime: BootstrapRuntime;
    transport: BootstrapTransport;
    type: StarterEmitterType;
  };
  id: StarterScaffoldRecipeId;
  platformPromptLabel?: string;
  promptLabel: string;
  schema: BootstrapSchema;
}

const DEFAULT_TOPOLOGY: BootstrapTopology = {
  deferred: true,
  mode: 'single-package',
};

function createSchema(
  shape: BootstrapShape,
  runtime: BootstrapRuntime,
  platform: BootstrapPlatform,
  transport: BootstrapTransport,
  tooling: BootstrapToolingPreset = 'standard',
): BootstrapSchema {
  return {
    platform,
    runtime,
    shape,
    tooling,
    topology: { ...DEFAULT_TOPOLOGY },
    transport,
  };
}

function cloneBootstrapSchema(schema: BootstrapSchema): BootstrapSchema {
  return {
    ...schema,
    topology: { ...schema.topology },
  };
}

/** Supported microservice starter transports recognized by `fluo new`. */
export const SUPPORTED_MICROSERVICE_STARTER_TRANSPORTS: readonly BootstrapTransport[] = [
  'tcp',
  'redis-streams',
  'nats',
  'kafka',
  'rabbitmq',
  'mqtt',
  'grpc',
];

/** Backward-compatible alias for the current shipped microservice starter transport list. */
export const DOCUMENTED_MICROSERVICE_TRANSPORTS = SUPPORTED_MICROSERVICE_STARTER_TRANSPORTS;

/** Source-of-truth registry for starter dependencies, prompt labels, and emitted scaffold recipes. */
export const STARTER_PROFILE_REGISTRY: readonly StarterProfile[] = [
  {
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
    id: 'application-bun-bun-http',
    platformPromptLabel: 'Bun native HTTP',
    promptLabel: 'Application (HTTP starter)',
    schema: createSchema('application', 'bun', 'bun', 'http'),
  },
  {
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
    id: 'application-deno-deno-http',
    platformPromptLabel: 'Deno native HTTP',
    promptLabel: 'Application (HTTP starter)',
    schema: createSchema('application', 'deno', 'deno', 'http'),
  },
  {
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
    id: 'application-cloudflare-workers-cloudflare-workers-http',
    platformPromptLabel: 'Cloudflare Workers',
    promptLabel: 'Application (HTTP starter)',
    schema: createSchema('application', 'cloudflare-workers', 'cloudflare-workers', 'http'),
  },
  {
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
    id: 'application-node-fastify-http',
    platformPromptLabel: 'Fastify',
    promptLabel: 'Application (HTTP starter)',
    schema: createSchema('application', 'node', 'fastify', 'http'),
  },
  {
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
    id: 'application-node-express-http',
    platformPromptLabel: 'Express',
    promptLabel: 'Application (HTTP starter)',
    schema: createSchema('application', 'node', 'express', 'http'),
  },
  {
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
    id: 'application-node-nodejs-http',
    platformPromptLabel: 'Raw Node.js HTTP',
    promptLabel: 'Application (HTTP starter)',
    schema: createSchema('application', 'node', 'nodejs', 'http'),
  },
  {
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
    id: 'microservice-node-none-tcp',
    promptLabel: 'Microservice (transport-first starter)',
    schema: createSchema('microservice', 'node', 'none', 'tcp'),
  },
  {
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
    id: 'microservice-node-none-redis-streams',
    promptLabel: 'Microservice (Redis Streams starter)',
    schema: createSchema('microservice', 'node', 'none', 'redis-streams'),
  },
  {
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
    id: 'microservice-node-none-mqtt',
    promptLabel: 'Microservice (MQTT starter)',
    schema: createSchema('microservice', 'node', 'none', 'mqtt'),
  },
  {
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
    id: 'microservice-node-none-grpc',
    promptLabel: 'Microservice (gRPC starter)',
    schema: createSchema('microservice', 'node', 'none', 'grpc'),
  },
  {
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
    id: 'microservice-node-none-nats',
    promptLabel: 'Microservice (NATS starter)',
    schema: createSchema('microservice', 'node', 'none', 'nats'),
  },
  {
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
    id: 'microservice-node-none-kafka',
    promptLabel: 'Microservice (Kafka starter)',
    schema: createSchema('microservice', 'node', 'none', 'kafka'),
  },
  {
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
    id: 'microservice-node-none-rabbitmq',
    promptLabel: 'Microservice (RabbitMQ starter)',
    schema: createSchema('microservice', 'node', 'none', 'rabbitmq'),
  },
  {
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
    id: 'mixed-node-fastify-tcp',
    promptLabel: 'Mixed (HTTP API + microservice starter)',
    schema: createSchema('mixed', 'node', 'fastify', 'tcp'),
  },
] as const;

/** Supported scaffold shapes accepted by the current starter matrix. */
export const SUPPORTED_BOOTSTRAP_SHAPES: readonly BootstrapShape[] = STARTER_PROFILE_REGISTRY.map((profile) => profile.schema.shape);
/** Supported runtime families accepted by the current starter matrix. */
export const SUPPORTED_BOOTSTRAP_RUNTIMES: readonly BootstrapRuntime[] = ['bun', 'cloudflare-workers', 'deno', 'node'];
/** Supported platform adapters accepted by the current starter matrix. */
export const SUPPORTED_BOOTSTRAP_PLATFORMS: readonly BootstrapPlatform[] = [
  'bun',
  'cloudflare-workers',
  'deno',
  'express',
  'fastify',
  'nodejs',
  'none',
];
/** Supported transports accepted by the current starter matrix. */
export const SUPPORTED_BOOTSTRAP_TRANSPORTS: readonly BootstrapTransport[] = ['http', ...SUPPORTED_MICROSERVICE_STARTER_TRANSPORTS];
/** Supported tooling presets accepted by the current starter matrix. */
export const SUPPORTED_BOOTSTRAP_TOOLING_PRESETS: readonly BootstrapToolingPreset[] = ['standard'];
/** Supported topology modes accepted by the current starter matrix. */
export const SUPPORTED_BOOTSTRAP_TOPOLOGY_MODES: readonly BootstrapTopology['mode'][] = ['single-package'];

/** Default starter profile used for shape-less `fluo new` invocations. */
export const DEFAULT_BOOTSTRAP_PROFILE = STARTER_PROFILE_REGISTRY.find((profile) => profile.id === 'application-node-fastify-http')!;

/**
 * Resolves the default starter profile for one shape/runtime branch.
 *
 * @param shape Shape requested by the caller.
 * @param runtime Optional runtime override used to pick Bun/Deno/Workers application defaults.
 * @returns The starter profile that defines the default contract for that branch.
 */
export function getStarterProfileForShape(shape: BootstrapShape, runtime?: BootstrapRuntime): StarterProfile {
  if (runtime !== undefined) {
    return STARTER_PROFILE_REGISTRY.find((profile) => (
      profile.schema.shape === shape && profile.schema.runtime === runtime
    )) ?? DEFAULT_BOOTSTRAP_PROFILE;
  }

  if (shape === 'application') {
    return DEFAULT_BOOTSTRAP_PROFILE;
  }

  if (shape === 'microservice') {
    return STARTER_PROFILE_REGISTRY.find((profile) => profile.id === 'microservice-node-none-tcp') ?? DEFAULT_BOOTSTRAP_PROFILE;
  }

  if (shape === 'mixed') {
    return STARTER_PROFILE_REGISTRY.find((profile) => profile.id === 'mixed-node-fastify-tcp') ?? DEFAULT_BOOTSTRAP_PROFILE;
  }

  return DEFAULT_BOOTSTRAP_PROFILE;
}

/**
 * Lists the application starter profiles currently published by the registry.
 *
 * @param runtime Optional runtime filter.
 * @returns Application starter profiles for the selected runtime, or all application starters when omitted.
 */
export function getApplicationStarterProfiles(runtime?: BootstrapRuntime): readonly StarterProfile[] {
  return STARTER_PROFILE_REGISTRY.filter((profile) => (
    profile.schema.shape === 'application' && (runtime === undefined || profile.schema.runtime === runtime)
  ));
}

/**
 * Clones the default bootstrap schema for one shape/runtime branch.
 *
 * @param shape Shape requested by the caller.
 * @param runtime Optional runtime override used for application starters.
 * @returns A fresh schema object safe to mutate during resolution.
 */
export function getDefaultBootstrapSchemaForShape(shape: BootstrapShape, runtime?: BootstrapRuntime): BootstrapSchema {
  return cloneBootstrapSchema(getStarterProfileForShape(shape, runtime).schema);
}

/**
 * Clones the global default bootstrap schema.
 *
 * @returns A fresh schema object for the default Node.js + Fastify HTTP starter.
 */
export function getDefaultBootstrapSchema(): BootstrapSchema {
  return cloneBootstrapSchema(DEFAULT_BOOTSTRAP_PROFILE.schema);
}

/**
 * Finds the starter profile that exactly matches a resolved bootstrap schema.
 *
 * @param schema Fully resolved bootstrap schema.
 * @returns The matching starter profile, or `undefined` when the schema is validation-only.
 */
export function getStarterProfileFromSchema(schema: BootstrapSchema): StarterProfile | undefined {
  return STARTER_PROFILE_REGISTRY.find((profile) => (
    profile.schema.shape === schema.shape
    && profile.schema.runtime === schema.runtime
    && profile.schema.platform === schema.platform
    && profile.schema.transport === schema.transport
    && profile.schema.tooling === schema.tooling
    && profile.schema.topology.deferred === schema.topology.deferred
    && profile.schema.topology.mode === schema.topology.mode
  ));
}

/**
 * Checks whether one transport belongs to the supported microservice starter transport family.
 *
 * @param transport Transport selected by the caller.
 * @returns `true` when the transport is part of the supported microservice starter transport set.
 */
export function isSupportedMicroserviceStarterTransport(transport: BootstrapTransport): boolean {
  return SUPPORTED_MICROSERVICE_STARTER_TRANSPORTS.includes(transport);
}

/** Backward-compatible alias for starter-transport membership checks. */
export const isDocumentedMicroserviceTransport = isSupportedMicroserviceStarterTransport;
