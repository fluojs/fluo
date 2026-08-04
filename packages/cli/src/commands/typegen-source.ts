import { existsSync } from 'node:fs';
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

type CreateTypegenSourceOptions = {
  readonly cwd: string;
  readonly modules: ReactTypegenModules;
  readonly parsed: ParsedTypegenArgs;
};

type GenerateTypegenSourceOptions = {
  readonly application: object;
  readonly modules: ReactTypegenModules;
  readonly parsed: ParsedTypegenArgs;
};

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

async function importProjectModule(moduleId: string, cwd: string, tsconfig: string | false): Promise<object> {
  const importOptions = [
    { parentURL: pathToFileURL(resolve(cwd, 'package.json')).href, tsconfig },
    { parentURL: import.meta.url, tsconfig: false },
  ] as const;
  for (const options of importOptions) {
    try {
      const imported = await tsImport(moduleId, options);
      if (typeof imported !== 'object' || imported === null) {
        throw new TypegenCommandError(`Resolved ${moduleId} to an invalid module namespace.`);
      }
      return imported;
    } catch (error: unknown) {
      if (!isModuleNotFoundError(error)) {
        throw error;
      }
    }
  }
  throw new TypegenCommandError(`Unable to resolve ${moduleId} from the inspected project.`);
}

async function importTypeScriptApplicationModule(modulePath: string): Promise<object> {
  const moduleUrl = pathToFileURL(modulePath).href;
  const tsconfigPath = resolve(dirname(modulePath), 'tsconfig.json');
  return existsSync(tsconfigPath)
    ? tsImport(moduleUrl, { parentURL: import.meta.url, tsconfig: tsconfigPath })
    : tsImport(moduleUrl, { parentURL: import.meta.url, tsconfig: false });
}

function requireNamespace(owner: object, name: string): object {
  const value = Reflect.get(owner, name);
  if (typeof value !== 'object' || value === null) {
    throw new TypegenCommandError(`Required typegen namespace ${name} is unavailable.`);
  }
  return value;
}

async function importNativeApplicationModule(modulePath: string): Promise<object> {
  applicationImportSequence += 1;
  const source = `import * as application from ${JSON.stringify(pathToFileURL(modulePath).href)};\nexport { application };\n`;
  const graphUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(source)}#fluo-typegen-${String(applicationImportSequence)}`;
  const graph = await tsImport(graphUrl, import.meta.url);
  return requireNamespace(graph, 'application');
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
 * @param tsconfig TypeScript configuration path, or `false` for native package resolution.
 * @returns React, React typegen, and runtime module namespaces.
 */
export async function loadReactTypegenModules(cwd: string, tsconfig: string | false = false): Promise<ReactTypegenModules> {
  const [react, typegen, runtime] = await Promise.all(
    TYPEGEN_MODULE_IDS.map((moduleId) => importProjectModule(moduleId, cwd, tsconfig)),
  );
  return { react, runtime, typegen };
}

/**
 * Bootstraps the selected module and generates source from authoritative route descriptors.
 *
 * @param options Parsed command, consumer directory, module namespaces, and native import boundary.
 * @returns Complete deterministic generated source.
 */
export async function createTypegenSource(options: CreateTypegenSourceOptions): Promise<string> {
  const modulePath = resolve(options.cwd, options.parsed.modulePath);
  const importedApplication = TYPESCRIPT_MODULE_EXTENSIONS.has(extname(modulePath))
    ? await importTypeScriptApplicationModule(modulePath)
    : await importNativeApplicationModule(modulePath);
  return generateTypegenSource({
    application: importedApplication,
    modules: options.modules,
    parsed: options.parsed,
  });
}

/**
 * Generates source from one already-imported application and its matching tooling namespaces.
 *
 * @param options Application namespace, generation modules, and parsed command selection.
 * @returns Complete deterministic generated source.
 */
export async function generateTypegenSource(options: GenerateTypegenSourceOptions): Promise<string> {
  const rootModule = Reflect.get(options.application, options.parsed.exportName);
  if (typeof rootModule !== 'function') {
    throw new TypegenCommandError(`Export "${options.parsed.exportName}" is not a module class constructor.`);
  }

  const factory = Reflect.get(options.modules.runtime, 'FluoFactory');
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
    const catalog = Reflect.apply(requireFunction(options.modules.react, 'createReactPageCatalog'), undefined, [descriptors]);
    const source = Reflect.apply(requireFunction(options.modules.typegen, 'generateReactPageTypes'), undefined, [catalog]);
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
