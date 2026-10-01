import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ReactFormTypeProjection, ReactJsonShape } from '@fluojs/react/typegen';
import { tsImport } from 'tsx/esm/api';
import { TypegenCompiler } from './typegen-compiler.js';
import type { ParsedTypegenArgs } from './typegen-options.js';
import { TypegenCommandError } from './typegen-options.js';
import { projectHandlerResult, projectHttpQuery } from './typegen-projection.js';
import { consumeTypegenSource, findTypegenTsconfig } from './typegen-source-loader.js';

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
  readonly snapshot?: TypegenCompiler;
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
  const typeScript = TYPESCRIPT_MODULE_EXTENSIONS.has(extname(modulePath));
  if (typeScript && typeof Reflect.get(options.modules.typegen, 'createHttpTypeProjection') === 'function') {
    const tsconfigPath = options.parsed.tsconfigPath === undefined ? findTypegenTsconfig(modulePath)
      : resolve(options.cwd, options.parsed.tsconfigPath);
    if (tsconfigPath === undefined) throw new TypegenCommandError(`${modulePath}: type projection requires the application's tsconfig.json.`);
    const snapshot = TypegenCompiler.create({ cwd: options.cwd, modulePath, tsconfigPath,
      artifactPath: resolve(options.cwd, options.parsed.outputPath) });
    return consumeTypegenSource({ modulePath, snapshot }, (application) => generateTypegenSource({
      application, modules: options.modules, parsed: options.parsed, snapshot,
    }));
  }
  const importedApplication = typeScript
    ? await tsImport(pathToFileURL(modulePath).href, {
      parentURL: import.meta.url,
      ...(options.parsed.tsconfigPath === undefined ? {} : {
        tsconfig: resolve(options.cwd, options.parsed.tsconfigPath),
      }),
    })
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
  const bootstrap: unknown = options.parsed.optionsExport === undefined
    ? {} : Reflect.get(options.application, options.parsed.optionsExport);
  if (typeof bootstrap !== 'object' || bootstrap === null || Array.isArray(bootstrap)) {
    throw new TypegenCommandError('Selected bootstrap options export must be the actual application options object.');
  }
  const application = await Reflect.apply(requireFunction(factory, 'create'), factory, [
    rootModule,
    { ...bootstrap, logger: SILENT_APPLICATION_LOGGER },
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
    const createCatalog = requireFunction(options.modules.react, 'createReactPageCatalog');
    const baseCatalog: unknown = Reflect.apply(createCatalog, undefined, [descriptors]);
    const snapshot = options.snapshot;
    const contracts: { modules: Record<string, ReactJsonShape>; forms: ReactFormTypeProjection[]; sourceFingerprint?: string } = {
      modules: {}, forms: [], ...(snapshot === undefined ? {} : { sourceFingerprint: snapshot.fingerprint }),
    };
    const catalog = snapshot === undefined
      ? baseCatalog
      : descriptors.flatMap((descriptor) => {
        const entries: unknown = Reflect.apply(createCatalog, undefined, [[descriptor]]);
        if (!Array.isArray(entries)) throw new TypegenCommandError('React catalog projection returned an invalid value.');
        const projection: unknown = Reflect.apply(requireFunction(options.modules.typegen, 'createHttpTypeProjection'), undefined, [descriptor]);
        const result = projectHandlerResult(snapshot, descriptor, entries.length > 0);
        for (const [module, shape] of Object.entries(result.modules)) {
          if (contracts.modules[module] !== undefined && JSON.stringify(contracts.modules[module]) !== JSON.stringify(shape)) {
            throw new TypegenCommandError(`Ambiguous compiler props contract for ${module}.`);
          }
          contracts.modules[module] = shape;
        }
        if (result.form !== undefined) {
          const routes: unknown = Reflect.apply(requireFunction(options.modules.runtime, 'createRuntimeRouteCatalog'), undefined, [[descriptor]]);
          const route: unknown = Array.isArray(routes) ? routes[0] : undefined;
          if (typeof route !== 'object' || route === null || !('id' in route) || typeof route.id !== 'string'
            || !('path' in route) || typeof route.path !== 'string' || !('params' in route) || !Array.isArray(route.params)) {
            throw new TypegenCommandError('Runtime HTTP form route projection is malformed.');
          }
          const metadata: unknown = typeof descriptor === 'object' && descriptor !== null
            ? Reflect.get(descriptor, 'metadata') : undefined;
          const versionSelection: unknown = typeof metadata === 'object' && metadata !== null
            ? Reflect.get(metadata, 'versionSelection') : undefined;
          if ('version' in route && route.version !== undefined && versionSelection !== 'URI') {
            throw new TypegenCommandError(`Versioned HTTP form route "${route.id}" requires authoritative URI selection for an action href.`);
          }
          contracts.forms.push({ id: route.id, path: route.path, params: route.params,
            input: projectHttpQuery(snapshot, projection, 'body'), ...result.form });
        }
        if (entries.length === 0) return [];
        const query = projectHttpQuery(snapshot, projection);
        return entries.map((entry: unknown) => {
          if (typeof entry !== 'object' || entry === null) throw new TypegenCommandError('React catalog entry is malformed.');
          return { ...entry, query, sourceFingerprint: snapshot.fingerprint };
        });
      });
    const source = Reflect.apply(requireFunction(options.modules.typegen, 'generateReactPageTypes'), undefined, [
      catalog,
      ...(Object.keys(contracts.modules).length === 0 && contracts.forms.length === 0 ? [] : [contracts]),
    ]);
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
