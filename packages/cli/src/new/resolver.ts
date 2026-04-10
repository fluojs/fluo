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

const SHAPES: readonly BootstrapShape[] = ['application'];
const RUNTIMES: readonly BootstrapRuntime[] = ['node'];
const PLATFORMS: readonly BootstrapPlatform[] = ['fastify'];
const TRANSPORTS: readonly BootstrapTransport[] = ['http'];
const TOOLING_PRESETS: readonly BootstrapToolingPreset[] = ['standard'];
const TOPOLOGY_MODES: readonly BootstrapTopology['mode'][] = ['single-package'];

type ResolvedHttpScaffoldEmitter = {
  platform: 'fastify';
  preset: 'standard';
  runtime: 'node';
  transport: 'http';
  type: 'http';
};

/**
 * Shape-first compatibility baseline for `fluo new` until additional starter variants ship.
 */
export const DEFAULT_BOOTSTRAP_SCHEMA: BootstrapSchema = {
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

/**
 * Dependency set required by the currently supported `fluo new` starter baseline.
 */
export interface ResolvedBootstrapDependencies {
  dependencies: readonly [
    '@fluojs/config',
    '@fluojs/core',
    '@fluojs/validation',
    '@fluojs/di',
    '@fluojs/http',
    '@fluojs/platform-fastify',
    '@fluojs/runtime',
  ];
  devDependencies: readonly [
    '@fluojs/cli',
    '@fluojs/testing',
  ];
}

/**
 * Scaffold planning result that routes a resolved schema into the correct emitter boundary.
 */
export interface ResolvedBootstrapPlan {
  dependencies: ResolvedBootstrapDependencies;
  emitter: ResolvedHttpScaffoldEmitter;
  schema: BootstrapSchema;
}

const DEFAULT_DEPENDENCIES: ResolvedBootstrapDependencies = {
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
  return {
    platform: assertOneOf('platform', partial.platform ?? DEFAULT_BOOTSTRAP_SCHEMA.platform, PLATFORMS),
    runtime: assertOneOf('runtime', partial.runtime ?? DEFAULT_BOOTSTRAP_SCHEMA.runtime, RUNTIMES),
    shape: assertOneOf('shape', partial.shape ?? DEFAULT_BOOTSTRAP_SCHEMA.shape, SHAPES),
    tooling: assertOneOf('tooling', partial.tooling ?? DEFAULT_BOOTSTRAP_SCHEMA.tooling, TOOLING_PRESETS),
    topology: normalizeTopology(partial.topology),
    transport: assertOneOf('transport', partial.transport ?? DEFAULT_BOOTSTRAP_SCHEMA.transport, TRANSPORTS),
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
    schema.shape !== 'application'
    || schema.runtime !== 'node'
    || schema.transport !== 'http'
    || schema.platform !== 'fastify'
    || schema.tooling !== 'standard'
    || schema.topology.deferred !== true
    || schema.topology.mode !== 'single-package'
  ) {
    throw new Error(
      `Unsupported bootstrap schema "${schema.shape}/${schema.runtime}/${schema.transport}/${schema.platform}/${schema.tooling}/${schema.topology.mode}". `
      + 'The current compatibility baseline only supports the standard single-package Node + Fastify HTTP starter.',
    );
  }

  return {
    dependencies: DEFAULT_DEPENDENCIES,
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
