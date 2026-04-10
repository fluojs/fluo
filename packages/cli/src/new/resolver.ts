import type {
  BootstrapOptions,
  BootstrapPlatform,
  BootstrapRuntime,
  BootstrapSchema,
  BootstrapShape,
  BootstrapToolingPreset,
  BootstrapTopology,
  BootstrapTransport,
} from './types.js';

type BootstrapResolutionInput = Partial<BootstrapSchema> & Pick<Partial<BootstrapOptions>, 'packageManager'>;

const SHAPES: readonly BootstrapShape[] = ['application', 'microservice'];
const RUNTIMES: readonly BootstrapRuntime[] = ['node'];
const PLATFORMS: readonly BootstrapPlatform[] = ['fastify', 'none'];
const TRANSPORTS: readonly BootstrapTransport[] = [
  'http',
  'tcp',
  'redis',
  'redis-streams',
  'nats',
  'kafka',
  'rabbitmq',
  'mqtt',
  'grpc',
];
const TOOLING_PRESETS: readonly BootstrapToolingPreset[] = ['standard'];
const TOPOLOGY_MODES: readonly BootstrapTopology['mode'][] = ['single-package'];
const MICROSERVICE_TRANSPORTS: readonly BootstrapTransport[] = [
  'tcp',
  'redis',
  'redis-streams',
  'nats',
  'kafka',
  'rabbitmq',
  'mqtt',
  'grpc',
];

type ResolvedHttpScaffoldEmitter = {
  platform: 'fastify';
  preset: 'standard';
  runtime: 'node';
  transport: 'http';
  type: 'http';
};

type ResolvedMicroserviceScaffoldEmitter = {
  platform: 'none';
  preset: 'standard';
  runtime: 'node';
  transport: 'tcp';
  type: 'microservice';
};

type ResolvedBootstrapDependencies = {
  dependencies: readonly string[];
  devDependencies: readonly string[];
};

const DEFAULT_APPLICATION_BOOTSTRAP_SCHEMA: BootstrapSchema = {
  platform: 'fastify',
  runtime: 'node',
  shape: 'application',
  tooling: 'standard',
  topology: {
    deferred: true,
    mode: 'single-package',
  },
  transport: 'http',
};

const DEFAULT_MICROSERVICE_BOOTSTRAP_SCHEMA: BootstrapSchema = {
  platform: 'none',
  runtime: 'node',
  shape: 'microservice',
  tooling: 'standard',
  topology: {
    deferred: true,
    mode: 'single-package',
  },
  transport: 'tcp',
};

/**
 * Shape-first compatibility baseline for `fluo new` until additional starter variants ship.
 */
export const DEFAULT_BOOTSTRAP_SCHEMA: BootstrapSchema = {
  ...DEFAULT_APPLICATION_BOOTSTRAP_SCHEMA,
};

/**
 * Dependency set required by the currently supported `fluo new` starter baseline.
 */
export interface ResolvedBootstrapPlan {
  dependencies: ResolvedBootstrapDependencies;
  emitter: ResolvedHttpScaffoldEmitter | ResolvedMicroserviceScaffoldEmitter;
  schema: BootstrapSchema;
}

const DEFAULT_HTTP_DEPENDENCIES: ResolvedBootstrapDependencies = {
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
};

const DEFAULT_MICROSERVICE_DEPENDENCIES: ResolvedBootstrapDependencies = {
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
};

function defaultSchemaForShape(shape: BootstrapShape): BootstrapSchema {
  return shape === 'microservice' ? DEFAULT_MICROSERVICE_BOOTSTRAP_SCHEMA : DEFAULT_APPLICATION_BOOTSTRAP_SCHEMA;
}

function assertOneOf<T extends string>(
  label: string,
  value: T,
  supported: readonly T[],
): T {
  if (!supported.includes(value)) {
    throw new Error(`Unsupported ${label} "${value}". Supported values: ${supported.join(', ')}.`);
  }

  return value;
}

function normalizeTopology(topology: Partial<BootstrapTopology> | undefined): BootstrapTopology {
  return {
    deferred: topology?.deferred ?? true,
    mode: assertOneOf('topology mode', topology?.mode ?? DEFAULT_BOOTSTRAP_SCHEMA.topology.mode, TOPOLOGY_MODES),
  };
}

/**
 * Resolves a partial starter schema onto the currently supported v2 compatibility baseline.
 *
 * @param partial Partial CLI/runtime schema selections.
 * @returns A normalized bootstrap schema with defaults applied.
 */
export function resolveBootstrapSchema(partial: Partial<BootstrapSchema> = {}): BootstrapSchema {
  const shape = assertOneOf('shape', partial.shape ?? DEFAULT_BOOTSTRAP_SCHEMA.shape, SHAPES);
  const defaults = defaultSchemaForShape(shape);

  return {
    platform: assertOneOf('platform', partial.platform ?? defaults.platform, PLATFORMS),
    runtime: assertOneOf('runtime', partial.runtime ?? defaults.runtime, RUNTIMES),
    shape,
    tooling: assertOneOf('tooling', partial.tooling ?? defaults.tooling, TOOLING_PRESETS),
    topology: normalizeTopology(partial.topology),
    transport: assertOneOf('transport', partial.transport ?? defaults.transport, TRANSPORTS),
  };
}

/**
 * Resolves the dependency and emitter plan for the requested starter schema.
 *
 * @param options Partial or full bootstrap options collected from the CLI/runtime surface.
 * @returns The normalized schema plus the emitter boundary that should render scaffold files.
 */
export function resolveBootstrapPlan(options: BootstrapResolutionInput | BootstrapOptions): ResolvedBootstrapPlan {
  const schema = resolveBootstrapSchema(options);

  if (
    schema.shape === 'application'
    && schema.runtime === 'node'
    && schema.transport === 'http'
    && schema.platform === 'fastify'
    && schema.tooling === 'standard'
    && schema.topology.deferred === true
    && schema.topology.mode === 'single-package'
  ) {
    return {
      dependencies: DEFAULT_HTTP_DEPENDENCIES,
      emitter: {
        platform: 'fastify',
        preset: 'standard',
        runtime: 'node',
        transport: 'http',
        type: 'http',
      },
      schema,
    };
  }

  if (
    schema.shape === 'microservice'
    && schema.runtime === 'node'
    && schema.transport === 'tcp'
    && schema.platform === 'none'
    && schema.tooling === 'standard'
    && schema.topology.deferred === true
    && schema.topology.mode === 'single-package'
  ) {
    return {
      dependencies: DEFAULT_MICROSERVICE_DEPENDENCIES,
      emitter: {
        platform: 'none',
        preset: 'standard',
        runtime: 'node',
        transport: 'tcp',
        type: 'microservice',
      },
      schema,
    };
  }

  if (schema.shape === 'microservice' && schema.transport === 'http') {
    throw new Error(
      'Unsupported bootstrap schema "microservice/node/http/' + schema.platform + '/standard/single-package". '
      + 'Microservice starters require a transport-aware microservice transport such as tcp, redis, nats, kafka, rabbitmq, mqtt, or grpc.',
    );
  }

  if (schema.shape === 'application' && MICROSERVICE_TRANSPORTS.includes(schema.transport)) {
    throw new Error(
      'Unsupported bootstrap schema "application/node/' + schema.transport + '/' + schema.platform + '/standard/single-package". '
      + 'Application starters currently require the HTTP transport.',
    );
  }

  if (schema.shape === 'microservice' && MICROSERVICE_TRANSPORTS.includes(schema.transport) && schema.transport !== 'tcp') {
    throw new Error(
      'Unsupported bootstrap schema "microservice/node/' + schema.transport + '/' + schema.platform + '/standard/single-package". '
      + 'The first-class microservice starter currently emits the runnable TCP starter, while transport validation recognizes the documented families: '
      + MICROSERVICE_TRANSPORTS.join(', ') + '.',
    );
  }

  if (
    schema.runtime !== 'node'
    || schema.tooling !== 'standard'
    || schema.topology.deferred !== true
    || schema.topology.mode !== 'single-package'
  ) {
    throw new Error(
      `Unsupported bootstrap schema "${schema.shape}/${schema.runtime}/${schema.transport}/${schema.platform}/${schema.tooling}/${schema.topology.mode}". `
      + 'The current compatibility baseline supports the standard single-package Node + Fastify HTTP starter and the TCP microservice starter.',
    );
  }

  throw new Error(
    `Unsupported bootstrap schema "${schema.shape}/${schema.runtime}/${schema.transport}/${schema.platform}/${schema.tooling}/${schema.topology.mode}". `
    + 'The current compatibility baseline supports the standard single-package Node + Fastify HTTP starter and the TCP microservice starter.',
  );
}
