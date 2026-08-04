import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { tsImport } from 'tsx/esm/api';

import type { ParsedTypegenArgs } from './typegen-options.js';
import { TypegenCommandError } from './typegen-options.js';

/** Dynamically loaded package surfaces required by typegen. */
export type ReactTypegenModules = {
  readonly react: object;
  readonly runtime: object;
  readonly typegen: object;
};

/** Structural artifact result returned by the React typegen package. */
export type ReactTypegenArtifactInspection =
  | { readonly status: 'malformed' }
  | { readonly status: 'unsupported-version'; readonly version: number }
  | { readonly status: 'valid'; readonly version: number };

const TYPESCRIPT_MODULE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const TYPEGEN_MODULE_IDS = ['@fluojs/react', '@fluojs/react/typegen', '@fluojs/runtime'] as const;
const SILENT_APPLICATION_LOGGER = Object.freeze({
  debug() {},
  error() {},
  log() {},
  warn() {},
});
let applicationImportSequence = 0;

function isModuleNotFoundError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error.code === 'MODULE_NOT_FOUND' || error.code === 'ERR_MODULE_NOT_FOUND');
}

async function importProjectModule(moduleId: string, cwd: string): Promise<object> {
  const resolvers = [createRequire(resolve(cwd, 'package.json')), createRequire(import.meta.url)];
  for (const resolver of resolvers) {
    let modulePath: string;
    try {
      modulePath = resolver.resolve(moduleId);
    } catch (error: unknown) {
      if (!isModuleNotFoundError(error)) {
        throw error;
      }
      continue;
    }
    return import(pathToFileURL(modulePath).href);
  }
  throw new TypegenCommandError(`Unable to resolve ${moduleId} from the inspected project.`);
}

async function importApplicationModule(modulePath: string): Promise<object> {
  const moduleUrl = pathToFileURL(modulePath).href;
  if (!TYPESCRIPT_MODULE_EXTENSIONS.has(extname(modulePath))) {
    applicationImportSequence += 1;
    return import(`${moduleUrl}?fluo-typegen=${String(applicationImportSequence)}`);
  }

  const tsconfigPath = resolve(dirname(modulePath), 'tsconfig.json');
  return existsSync(tsconfigPath)
    ? tsImport(moduleUrl, { parentURL: import.meta.url, tsconfig: tsconfigPath })
    : tsImport(moduleUrl, import.meta.url);
}

function requireFunction(owner: object, name: string): (...args: readonly unknown[]) => unknown {
  const value = Reflect.get(owner, name);
  if (typeof value !== 'function') {
    throw new TypegenCommandError(`Required typegen function ${name} is unavailable.`);
  }
  return value;
}

/**
 * Loads typegen package entrypoints from the consumer project or CLI installation.
 *
 * @param cwd Consumer project directory used for package resolution.
 * @returns React, React typegen, and runtime module namespaces.
 */
export async function loadReactTypegenModules(cwd: string): Promise<ReactTypegenModules> {
  const [react, typegen, runtime] = await Promise.all(TYPEGEN_MODULE_IDS.map((moduleId) => importProjectModule(moduleId, cwd)));
  return { react, runtime, typegen };
}

/**
 * Bootstraps the selected module and generates source from authoritative route descriptors.
 *
 * @param parsed Parsed typegen command options.
 * @param cwd Consumer project directory.
 * @param modules Loaded React and runtime tooling modules.
 * @returns Complete deterministic generated source.
 */
export async function createTypegenSource(
  parsed: ParsedTypegenArgs,
  cwd: string,
  modules: ReactTypegenModules,
): Promise<string> {
  const importedApplication = await importApplicationModule(resolve(cwd, parsed.modulePath));
  const rootModule = Reflect.get(importedApplication, parsed.exportName);
  if (typeof rootModule !== 'function') {
    throw new TypegenCommandError(`Export "${parsed.exportName}" is not a module class constructor.`);
  }

  const factory = Reflect.get(modules.runtime, 'FluoFactory');
  if (typeof factory !== 'function') {
    throw new TypegenCommandError('Required runtime FluoFactory is unavailable.');
  }
  const application = await Reflect.apply(requireFunction(factory, 'create'), factory, [
    rootModule,
    { logger: SILENT_APPLICATION_LOGGER },
  ]);
  if (typeof application !== 'object' || application === null) {
    throw new TypegenCommandError('Runtime application bootstrap returned an invalid value.');
  }

  const close = requireFunction(application, 'close');
  try {
    const dispatcher = Reflect.get(application, 'dispatcher');
    if (typeof dispatcher !== 'object' || dispatcher === null) {
      throw new TypegenCommandError('Runtime application dispatcher is unavailable.');
    }
    const descriptors = Reflect.apply(requireFunction(dispatcher, 'describeRoutes'), dispatcher, []);
    if (!Array.isArray(descriptors)) {
      throw new TypegenCommandError('Runtime route descriptors are unavailable.');
    }
    const catalog = Reflect.apply(requireFunction(modules.react, 'createReactPageCatalog'), undefined, [descriptors]);
    const source = Reflect.apply(requireFunction(modules.typegen, 'generateReactPageTypes'), undefined, [catalog]);
    if (typeof source !== 'string') {
      throw new TypegenCommandError('React page typegen returned an invalid artifact.');
    }
    return source;
  } finally {
    await Reflect.apply(close, application, []);
  }
}

/**
 * Inspects an existing generated source value through the loaded React typegen package.
 *
 * @param modules Loaded React typegen module namespace.
 * @param source Existing artifact source.
 * @returns Parsed current, malformed, or unsupported-version status.
 */
export function inspectReactTypegenArtifact(
  modules: ReactTypegenModules,
  source: string,
): ReactTypegenArtifactInspection {
  const inspection = Reflect.apply(requireFunction(modules.typegen, 'inspectReactPageTypeArtifact'), undefined, [source]);
  if (typeof inspection !== 'object' || inspection === null || !('status' in inspection)) {
    throw new TypegenCommandError('React page typegen artifact inspection returned an invalid result.');
  }
  if (inspection.status === 'malformed') {
    return { status: 'malformed' };
  }
  if (
    inspection.status === 'unsupported-version'
    && 'version' in inspection
    && typeof inspection.version === 'number'
  ) {
    return { status: 'unsupported-version', version: inspection.version };
  }
  if (inspection.status === 'valid' && 'version' in inspection && typeof inspection.version === 'number') {
    return { status: 'valid', version: inspection.version };
  }
  throw new TypegenCommandError('React page typegen artifact inspection returned an invalid result.');
}
