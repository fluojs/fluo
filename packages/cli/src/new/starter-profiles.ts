import type {
  BootstrapPlatform,
  BootstrapRuntime,
  BootstrapSchema,
  BootstrapShape,
  BootstrapToolingPreset,
  BootstrapTopology,
  BootstrapTransport,
} from './types.js';

export type StarterEmitterType = 'http' | 'microservice' | 'mixed';
export type StarterScaffoldRecipeId = 'application-node-fastify-http' | 'microservice-node-none-tcp' | 'mixed-node-fastify-tcp';

type StarterDependencies = {
  dependencies: readonly string[];
  devDependencies: readonly string[];
};

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

export const DOCUMENTED_MICROSERVICE_TRANSPORTS: readonly BootstrapTransport[] = [
  'tcp',
  'redis',
  'redis-streams',
  'nats',
  'kafka',
  'rabbitmq',
  'mqtt',
  'grpc',
];

export const STARTER_PROFILE_REGISTRY: readonly StarterProfile[] = [
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
    promptLabel: 'Application (HTTP starter)',
    schema: createSchema('application', 'node', 'fastify', 'http'),
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

export const SUPPORTED_BOOTSTRAP_SHAPES: readonly BootstrapShape[] = STARTER_PROFILE_REGISTRY.map((profile) => profile.schema.shape);
export const SUPPORTED_BOOTSTRAP_RUNTIMES: readonly BootstrapRuntime[] = ['node'];
export const SUPPORTED_BOOTSTRAP_PLATFORMS: readonly BootstrapPlatform[] = ['fastify', 'none'];
export const SUPPORTED_BOOTSTRAP_TRANSPORTS: readonly BootstrapTransport[] = ['http', ...DOCUMENTED_MICROSERVICE_TRANSPORTS];
export const SUPPORTED_BOOTSTRAP_TOOLING_PRESETS: readonly BootstrapToolingPreset[] = ['standard'];
export const SUPPORTED_BOOTSTRAP_TOPOLOGY_MODES: readonly BootstrapTopology['mode'][] = ['single-package'];

export const DEFAULT_BOOTSTRAP_PROFILE = STARTER_PROFILE_REGISTRY[0]!;

export function getStarterProfileForShape(shape: BootstrapShape): StarterProfile {
  return STARTER_PROFILE_REGISTRY.find((profile) => profile.schema.shape === shape) ?? DEFAULT_BOOTSTRAP_PROFILE;
}

export function getDefaultBootstrapSchemaForShape(shape: BootstrapShape): BootstrapSchema {
  return cloneBootstrapSchema(getStarterProfileForShape(shape).schema);
}

export function getDefaultBootstrapSchema(): BootstrapSchema {
  return cloneBootstrapSchema(DEFAULT_BOOTSTRAP_PROFILE.schema);
}

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

export function isDocumentedMicroserviceTransport(transport: BootstrapTransport): boolean {
  return DOCUMENTED_MICROSERVICE_TRANSPORTS.includes(transport);
}
