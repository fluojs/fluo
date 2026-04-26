import type { GeneratorFactory, GeneratorOptionSchema } from '../generator-types.js';

import { generateControllerFiles } from './controller.js';
import { generateGuardFiles } from './guard.js';
import { generateInterceptorFiles } from './interceptor.js';
import { generateMiddlewareFiles } from './middleware.js';
import { generateModuleFiles } from './module.js';
import { generateRepoFiles } from './repository.js';
import { generateRequestDtoFiles } from './request-dto.js';
import { generateResponseDtoFiles } from './response-dto.js';
import { generateServiceFiles } from './service.js';

/** Module metadata array names that auto-registered generators are allowed to update. */
export type ModuleArrayKey = 'controllers' | 'providers' | 'middleware';

type ModuleRegistrationDescriptor = {
  arrayKey: ModuleArrayKey;
  classSuffix: string;
};

/** Describes one built-in generator schematic and its CLI-facing metadata. */
export type GeneratorManifestEntry = {
  aliases: readonly string[];
  description: string;
  factory: GeneratorFactory;
  kind: string;
  moduleRegistration?: ModuleRegistrationDescriptor;
  nextStepHint: string;
  registryAliases?: readonly string[];
  schematic: string;
  wiringBehavior: 'auto-registered' | 'files-only';
};

/** Describes a deterministic collection of generator schematics discoverable by the CLI. */
export type GeneratorCollection = {
  description: string;
  generators: readonly GeneratorManifestEntry[];
  id: string;
  source: 'built-in';
};

/** Option metadata shared by generate-command parsing, help output, docs, and tests. */
export const generatorOptionSchemas = [
  { aliases: ['-o'], description: 'Write generated files under a specific source directory.', name: '--target-directory <path>', value: 'path' },
  { aliases: ['-f'], description: 'Overwrite files that already exist.', name: '--force', value: 'boolean' },
  { aliases: [], description: 'Preview planned writes, skips, and module wiring without touching files.', name: '--dry-run', value: 'boolean' },
  { aliases: ['-h'], description: 'Show help for the generate command.', name: '--help', value: 'boolean' },
] as const satisfies readonly GeneratorOptionSchema[];

const builtInGeneratorDefinitions = [
  {
    aliases: ['co'],
    description: 'Generate a controller (auto-registered in the module controllers array).',
    factory: (name, options) => generateControllerFiles(name, options),
    kind: 'controller',
    moduleRegistration: { arrayKey: 'controllers', classSuffix: 'Controller' },
    nextStepHint: "Run 'pnpm typecheck' to verify module wiring, then add route handlers.",
    schematic: 'controller',
    wiringBehavior: 'auto-registered',
  },
  {
    aliases: ['gu'],
    description: 'Generate a guard (auto-registered as a provider in the module).',
    factory: (name) => generateGuardFiles(name),
    kind: 'guard',
    moduleRegistration: { arrayKey: 'providers', classSuffix: 'Guard' },
    nextStepHint: "Run 'pnpm typecheck' to verify module wiring, then apply the guard to routes.",
    schematic: 'guard',
    wiringBehavior: 'auto-registered',
  },
  {
    aliases: ['in'],
    description: 'Generate an interceptor (auto-registered as a provider in the module).',
    factory: (name) => generateInterceptorFiles(name),
    kind: 'interceptor',
    moduleRegistration: { arrayKey: 'providers', classSuffix: 'Interceptor' },
    nextStepHint: "Run 'pnpm typecheck' to verify module wiring, then bind the interceptor to routes.",
    schematic: 'interceptor',
    wiringBehavior: 'auto-registered',
  },
  {
    aliases: ['mi'],
    description: 'Generate a middleware (auto-registered in the module middleware array).',
    factory: (name) => generateMiddlewareFiles(name),
    kind: 'middleware',
    moduleRegistration: { arrayKey: 'middleware', classSuffix: 'Middleware' },
    nextStepHint: "Run 'pnpm typecheck' to verify module wiring, then configure route matching in forRoutes.",
    schematic: 'middleware',
    wiringBehavior: 'auto-registered',
  },
  {
    aliases: ['mo'],
    description: 'Generate a standalone module (import it in a parent module to activate).',
    factory: (name) => generateModuleFiles(name),
    kind: 'module',
    nextStepHint: "Import the new module in a parent module's imports array, then run 'pnpm typecheck'.",
    schematic: 'module',
    wiringBehavior: 'files-only',
  },
  {
    aliases: ['repo'],
    description: 'Generate a persistence-agnostic repository (auto-registered as a provider).',
    factory: (name, options) => generateRepoFiles(name, options),
    kind: 'repo',
    moduleRegistration: { arrayKey: 'providers', classSuffix: 'Repo' },
    nextStepHint: "Run 'pnpm typecheck' to verify module wiring, then add data-access methods to the repo stub.",
    registryAliases: ['repository'],
    schematic: 'repository',
    wiringBehavior: 'auto-registered',
  },
  {
    aliases: ['req'],
    description: 'Generate a request DTO for route-level data binding and validation (files only — wire it into a controller manually).',
    factory: (name) => generateRequestDtoFiles(name),
    kind: 'request-dto',
    nextStepHint: 'Import the DTO in a controller and add it as a parameter with @FromBody or @FromQuery.',
    schematic: 'request-dto',
    wiringBehavior: 'files-only',
  },
  {
    aliases: ['res'],
    description: 'Generate a response DTO for typed response payloads (files only — use it as a controller return type).',
    factory: (name) => generateResponseDtoFiles(name),
    kind: 'response-dto',
    nextStepHint: 'Import the DTO in a controller and use it as the return type for route handlers.',
    schematic: 'response-dto',
    wiringBehavior: 'files-only',
  },
  {
    aliases: ['s'],
    description: 'Generate a service (auto-registered as a provider in the module).',
    factory: (name, options) => generateServiceFiles(name, options),
    kind: 'service',
    moduleRegistration: { arrayKey: 'providers', classSuffix: 'Service' },
    nextStepHint: "Run 'pnpm typecheck' to verify module wiring, then implement business logic.",
    schematic: 'service',
    wiringBehavior: 'auto-registered',
  },
] as const satisfies readonly GeneratorManifestEntry[];

/** The single generator collection shipped directly inside `@fluojs/cli`. */
export const builtInGeneratorCollection = {
  description: 'The deterministic collection of generator schematics shipped by @fluojs/cli.',
  generators: builtInGeneratorDefinitions,
  id: '@fluojs/cli/builtin',
  source: 'built-in',
} as const satisfies GeneratorCollection;

/** Deterministic list of generator collections currently discovered by `fluo generate`. */
export const generatorCollections = [builtInGeneratorCollection] as const satisfies readonly GeneratorCollection[];

/** Built-in generator manifest used by CLI parsing, help output, and command execution. */
export const generatorManifest = builtInGeneratorCollection.generators;

/** Union of generator kind tokens accepted by the built-in generator manifest. */
export type GeneratorKind = (typeof generatorManifest)[number]['kind'];

/** Exact manifest entry type for one built-in generator definition. */
export type GeneratorDefinition = (typeof generatorManifest)[number];

const generatorByKind = new Map<GeneratorKind, GeneratorDefinition>();
const tokenToKind = new Map<string, GeneratorKind>();

for (const entry of generatorManifest) {
  generatorByKind.set(entry.kind, entry);
  tokenToKind.set(entry.kind, entry.kind);
  tokenToKind.set(entry.schematic, entry.kind);
  for (const alias of entry.aliases) {
    tokenToKind.set(alias, entry.kind);
  }
}

/**
 * Looks up one built-in generator definition by canonical kind.
 *
 * @param kind Canonical generator kind to resolve.
 * @returns The matching built-in generator definition.
 */
export function findGeneratorDefinition(kind: GeneratorKind): GeneratorDefinition {
  const entry = generatorByKind.get(kind);
  if (!entry) {
    throw new Error(`Unknown generator kind: ${kind}`);
  }

  return entry;
}

/**
 * Lists generator collections that `fluo generate` discovers without loading external code.
 *
 * @returns The deterministic generator collection list.
 */
export function listGeneratorCollections(): readonly GeneratorCollection[] {
  return generatorCollections;
}

/**
 * Lists generator definitions for a known collection.
 *
 * @param collectionId Collection identifier to read, defaulting to the built-in collection.
 * @returns Generator definitions owned by the requested collection.
 */
export function listGeneratorDefinitions(collectionId: string = builtInGeneratorCollection.id): readonly GeneratorDefinition[] {
  const collection = generatorCollections.find((entry) => entry.id === collectionId);
  if (!collection) {
    throw new Error(`Unknown generator collection: ${collectionId}`);
  }

  return collection.generators;
}

/**
 * Resolves a CLI token or alias to a canonical generator kind.
 *
 * @param value Raw CLI generator token or alias.
 * @returns The canonical generator kind when the token is known, otherwise `undefined`.
 */
export function resolveGeneratorKind(value: string | undefined): GeneratorKind | undefined {
  if (!value) {
    return undefined;
  }

  return tokenToKind.get(value);
}
