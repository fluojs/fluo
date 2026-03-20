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
  registryAliases?: readonly string[];
  schematic: string;
};

export const generatorManifest = [
  {
    aliases: ['co'],
    description: 'Generate a controller and register it in the module controllers array.',
    factory: (name) => generateControllerFiles(name),
    kind: 'controller',
    moduleRegistration: { arrayKey: 'controllers', classSuffix: 'Controller' },
    schematic: 'controller',
  },
  {
    aliases: ['gu'],
    description: 'Generate a guard and register it as a provider.',
    factory: (name) => generateGuardFiles(name),
    kind: 'guard',
    moduleRegistration: { arrayKey: 'providers', classSuffix: 'Guard' },
    schematic: 'guard',
  },
  {
    aliases: ['in'],
    description: 'Generate an interceptor and register it as a provider.',
    factory: (name) => generateInterceptorFiles(name),
    kind: 'interceptor',
    moduleRegistration: { arrayKey: 'providers', classSuffix: 'Interceptor' },
    schematic: 'interceptor',
  },
  {
    aliases: ['mi'],
    description: 'Generate a middleware and register it in the module middleware array.',
    factory: (name) => generateMiddlewareFiles(name),
    kind: 'middleware',
    moduleRegistration: { arrayKey: 'middleware', classSuffix: 'Middleware' },
    schematic: 'middleware',
  },
  {
    aliases: ['mo'],
    description: 'Generate a module.',
    factory: (name) => generateModuleFiles(name),
    kind: 'module',
    schematic: 'module',
  },
  {
    aliases: ['repo'],
    description: 'Generate a repository.',
    factory: (name, options) => generateRepoFiles(name, options),
    kind: 'repo',
    moduleRegistration: { arrayKey: 'providers', classSuffix: 'Repo' },
    registryAliases: ['repository'],
    schematic: 'repository',
  },
  {
    aliases: ['req'],
    description: 'Generate a request DTO with body binding and validation.',
    factory: (name) => generateRequestDtoFiles(name),
    kind: 'request-dto',
    schematic: 'request-dto',
  },
  {
    aliases: ['res'],
    description: 'Generate a response DTO for typed response payloads.',
    factory: (name) => generateResponseDtoFiles(name),
    kind: 'response-dto',
    schematic: 'response-dto',
  },
  {
    aliases: ['s'],
    description: 'Generate a service and register it as a provider.',
    factory: (name, options) => generateServiceFiles(name, options),
    kind: 'service',
    moduleRegistration: { arrayKey: 'providers', classSuffix: 'Service' },
    schematic: 'service',
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
