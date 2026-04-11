import type {
  BootstrapOptions,
  BootstrapSchema,
  BootstrapShape,
  BootstrapTopology,
} from './types.js';
import {
  DOCUMENTED_MICROSERVICE_TRANSPORTS,
  getDefaultBootstrapSchema,
  getDefaultBootstrapSchemaForShape,
  getStarterProfileForShape,
  getStarterProfileFromSchema,
  isDocumentedMicroserviceTransport,
  SUPPORTED_BOOTSTRAP_PLATFORMS,
  SUPPORTED_BOOTSTRAP_RUNTIMES,
  SUPPORTED_BOOTSTRAP_SHAPES,
  SUPPORTED_BOOTSTRAP_TOOLING_PRESETS,
  SUPPORTED_BOOTSTRAP_TOPOLOGY_MODES,
  SUPPORTED_BOOTSTRAP_TRANSPORTS,
  type StarterProfile,
} from './starter-profiles.js';

type BootstrapResolutionInput = Partial<BootstrapSchema> & Pick<Partial<BootstrapOptions>, 'packageManager'>;

/**
 * Shape-first compatibility baseline for `fluo new` until additional starter variants ship.
 */
export const DEFAULT_BOOTSTRAP_SCHEMA: BootstrapSchema = getDefaultBootstrapSchema();

/**
 * Dependency set required by the currently supported `fluo new` starter baseline.
 */
export interface ResolvedBootstrapPlan {
  dependencies: StarterProfile['dependencies'];
  emitter: StarterProfile['emitter'];
  profile: StarterProfile;
  schema: BootstrapSchema;
}

function defaultSchemaForShape(shape: BootstrapShape): BootstrapSchema {
  return getDefaultBootstrapSchemaForShape(shape);
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
    mode: assertOneOf('topology mode', topology?.mode ?? DEFAULT_BOOTSTRAP_SCHEMA.topology.mode, SUPPORTED_BOOTSTRAP_TOPOLOGY_MODES),
  };
}

/**
 * Resolves a partial starter schema onto the currently supported v2 compatibility baseline.
 *
 * @param partial Partial CLI/runtime schema selections.
 * @returns A normalized bootstrap schema with defaults applied.
 */
export function resolveBootstrapSchema(partial: Partial<BootstrapSchema> = {}): BootstrapSchema {
  const shape = assertOneOf('shape', partial.shape ?? DEFAULT_BOOTSTRAP_SCHEMA.shape, SUPPORTED_BOOTSTRAP_SHAPES);
  const defaults = defaultSchemaForShape(shape);

  return {
    platform: assertOneOf('platform', partial.platform ?? defaults.platform, SUPPORTED_BOOTSTRAP_PLATFORMS),
    runtime: assertOneOf('runtime', partial.runtime ?? defaults.runtime, SUPPORTED_BOOTSTRAP_RUNTIMES),
    shape,
    tooling: assertOneOf('tooling', partial.tooling ?? defaults.tooling, SUPPORTED_BOOTSTRAP_TOOLING_PRESETS),
    topology: normalizeTopology(partial.topology),
    transport: assertOneOf('transport', partial.transport ?? defaults.transport, SUPPORTED_BOOTSTRAP_TRANSPORTS),
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
  const starterProfile = getStarterProfileFromSchema(schema);

  if (starterProfile) {
    return {
      dependencies: starterProfile.dependencies,
      emitter: starterProfile.emitter,
      profile: starterProfile,
      schema,
    };
  }

  const defaultProfile = getStarterProfileForShape(schema.shape);

  if (schema.shape === 'microservice' && schema.transport === 'http') {
    throw new Error(
      'Unsupported bootstrap schema "microservice/node/http/' + schema.platform + '/standard/single-package". '
      + 'Microservice starters require a transport-aware microservice transport such as tcp, redis, nats, kafka, rabbitmq, mqtt, or grpc.',
    );
  }

  if (schema.shape === 'application' && isDocumentedMicroserviceTransport(schema.transport)) {
    throw new Error(
      'Unsupported bootstrap schema "application/node/' + schema.transport + '/' + schema.platform + '/standard/single-package". '
      + 'Application starters currently require the HTTP transport.',
    );
  }

  if (schema.shape === 'mixed' && schema.transport === 'http') {
    throw new Error(
      'Unsupported bootstrap schema "mixed/node/http/' + schema.platform + '/standard/' + schema.topology.mode + '". '
      + 'The first mixed starter uses the HTTP API plus an attached TCP microservice; use tcp for the supported mixed contract.',
    );
  }

  if (schema.shape === 'microservice' && isDocumentedMicroserviceTransport(schema.transport) && schema.transport !== defaultProfile.schema.transport) {
    throw new Error(
      'Unsupported bootstrap schema "microservice/node/' + schema.transport + '/' + schema.platform + '/standard/single-package". '
      + 'The first-class microservice starter currently emits the runnable TCP starter, while transport validation recognizes the documented families: '
      + DOCUMENTED_MICROSERVICE_TRANSPORTS.join(', ') + '.',
    );
  }

  if (schema.shape === 'mixed' && isDocumentedMicroserviceTransport(schema.transport) && schema.transport !== defaultProfile.schema.transport) {
    throw new Error(
      'Unsupported bootstrap schema "mixed/node/' + schema.transport + '/' + schema.platform + '/standard/' + schema.topology.mode + '". '
      + 'The first mixed starter currently supports only the attached TCP microservice contract.',
    );
  }

  if (schema.shape === 'application' && schema.topology.mode !== 'single-package') {
    throw new Error(
      'Unsupported bootstrap schema "application/node/' + schema.transport + '/' + schema.platform + '/standard/' + schema.topology.mode + '". '
      + 'Application starters currently support only the single-package HTTP topology; use --shape mixed for the API + microservice starter.',
    );
  }

  if (schema.shape === 'microservice' && schema.topology.mode !== 'single-package') {
    throw new Error(
      'Unsupported bootstrap schema "microservice/node/' + schema.transport + '/' + schema.platform + '/standard/' + schema.topology.mode + '". '
      + 'Microservice starters currently support only the single-package microservice topology.',
    );
  }

  if (schema.shape === 'mixed' && schema.topology.mode !== 'single-package') {
    throw new Error(
      'Unsupported bootstrap schema "mixed/node/' + schema.transport + '/' + schema.platform + '/standard/' + schema.topology.mode + '". '
      + 'Mixed starters currently support only the single-package contract: one Fastify HTTP application with an attached TCP microservice.',
    );
  }

  if (
    schema.runtime !== 'node'
    || schema.tooling !== 'standard'
    || schema.topology.deferred !== true
  ) {
    throw new Error(
      `Unsupported bootstrap schema "${schema.shape}/${schema.runtime}/${schema.transport}/${schema.platform}/${schema.tooling}/${schema.topology.mode}". `
      + 'The current compatibility baseline supports the standard single-package Node + Fastify HTTP starter, the TCP microservice starter, and the mixed single-package starter.',
    );
  }

  throw new Error(
    `Unsupported bootstrap schema "${schema.shape}/${schema.runtime}/${schema.transport}/${schema.platform}/${schema.tooling}/${schema.topology.mode}". `
    + 'The current compatibility baseline supports the standard single-package Node + Fastify HTTP starter, the TCP microservice starter, and the mixed single-package starter.',
  );
}
