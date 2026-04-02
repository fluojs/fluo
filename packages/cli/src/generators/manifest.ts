import type { GeneratorFactory } from '../generator-types.js';

import { generateControllerFiles } from './controller.js';
import { generateGuardFiles } from './guard.js';
import { generateInterceptorFiles } from './interceptor.js';
import { generateMiddlewareFiles } from './middleware.js';
import { generateModuleFiles } from './module.js';
import { generateRepoFiles } from './repository.js';
import { generateRequestDtoFiles } from './request-dto.js';
import { generateResponseDtoFiles } from './response-dto.js';
import { generateServiceFiles } from './service.js';

export type ModuleArrayKey = 'controllers' | 'providers' | 'middleware';

type ModuleRegistrationDescriptor = {
  arrayKey: ModuleArrayKey;
  classSuffix: string;
};

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

export const generatorManifest = [
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

export type GeneratorKind = (typeof generatorManifest)[number]['kind'];
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

export function findGeneratorDefinition(kind: GeneratorKind): GeneratorDefinition {
  const entry = generatorByKind.get(kind);
  if (!entry) {
    throw new Error(`Unknown generator kind: ${kind}`);
  }

  return entry;
}

export function resolveGeneratorKind(value: string | undefined): GeneratorKind | undefined {
  if (!value) {
    return undefined;
  }

  return tokenToKind.get(value);
}
