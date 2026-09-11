import type { Plugin, ResolvedConfig } from 'vite';

type BabelCoreModule = Pick<typeof import('@babel/core'), 'transformAsync'>;
type BabelCoreImporter = () => Promise<BabelCoreModule>;

/**
 * Selects whether the plugin runs for application modules only or for a Vitest module graph.
 */
export type FluoDecoratorsTransformBoundary = 'application' | 'test';

/**
 * Configuration for the canonical fluo TC39 decorator transform.
 */
export interface FluoDecoratorsPluginOptions {
  /**
   * Selects the file boundary. Application mode skips test, spec, and declaration files;
   * test mode includes application and test modules while still skipping declarations.
   */
  readonly transformBoundary?: FluoDecoratorsTransformBoundary;
  /**
   * Uses this Babel root configuration for every transformed module, or resolves it per module.
   * The default disables Babel configuration discovery.
   */
  readonly babelConfigFile?: false | string | ((filePath: string) => string);
  /**
   * Overrides Vite's sourcemap policy. Omit it to use source maps during serve and mapped builds.
   */
  readonly sourceMaps?: boolean;
}

const BABEL_PEER_DEPENDENCIES = [
  '@babel/core',
  '@babel/plugin-proposal-decorators',
  '@babel/preset-typescript',
] as const;

function readErrorCode(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('code' in value)) {
    return undefined;
  }

  const code = value.code;

  return typeof code === 'string' ? code : undefined;
}

function readErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function isMissingPeerDependencyError(error: unknown): boolean {
  const code = readErrorCode(error);
  const message = readErrorMessage(error);

  return (
    (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND' || message.includes('Cannot find package')) &&
    BABEL_PEER_DEPENDENCIES.some((dependencyName) => message.includes(dependencyName))
  );
}

function createBabelTransformDiagnostic(error: unknown, filePath: string): Error {
  const message = readErrorMessage(error);

  if (!isMissingPeerDependencyError(error)) {
    return error instanceof Error ? error : new Error(message);
  }

  return new Error(
    `[fluo-babel-decorators] Failed to resolve a Babel peer dependency while transforming ${filePath}. ` +
      'Install @babel/core, @babel/plugin-proposal-decorators, and @babel/preset-typescript in the Vite project. ' +
      `Original error: ${message}`,
  );
}

async function importBabelCore(): Promise<BabelCoreModule> {
  return await import('@babel/core');
}

async function loadBabelCore(filePath: string, importBabelCoreModule: BabelCoreImporter): Promise<BabelCoreModule> {
  try {
    return await importBabelCoreModule();
  } catch (error) {
    throw createBabelTransformDiagnostic(error, filePath);
  }
}

function readViteFilePath(id: string): string {
  const filePath = id.split(/[?#]/, 1)[0] ?? id;

  return filePath;
}

function isNodeModulesPath(filePath: string): boolean {
  return /(?:^|\/)node_modules(?:\/|$)/u.test(filePath);
}

function isTypeScriptTestFile(filePath: string): boolean {
  return /\.(?:test|spec)\.(?:cts|mts|ts|tsx)$/u.test(filePath);
}

function isTypeScriptDeclarationFile(filePath: string): boolean {
  return /\.d\.(?:cts|mts|ts)$/u.test(filePath);
}

function isTypeScriptSourceFile(filePath: string): boolean {
  return /\.(?:cts|mts|ts|tsx)$/u.test(filePath);
}

function shouldTransformTypeScriptFile(id: string, transformBoundary: FluoDecoratorsTransformBoundary): boolean {
  const normalizedFilePath = readViteFilePath(id).replaceAll('\\', '/');

  if (!isTypeScriptSourceFile(normalizedFilePath) || isTypeScriptDeclarationFile(normalizedFilePath)) {
    return false;
  }

  return !isNodeModulesPath(normalizedFilePath)
    && (transformBoundary === 'test' || !isTypeScriptTestFile(normalizedFilePath));
}

function shouldRequestBabelSourceMaps(config: Pick<ResolvedConfig, 'build' | 'command'>): boolean {
  return config.command === 'serve' || Boolean(config.build.sourcemap);
}

function withMetadataPreload(code: string): string {
  return /(?:^|\n)\s*@\p{ID_Start}/u.test(code) || /[;{]\s*@\p{ID_Start}/u.test(code)
    ? `import '@fluojs/core/metadata-preload';\n${code}`
    : code;
}

/**
 * Creates the Vite transform plugin used by fluo starter projects to compile
 * TC39 standard decorator syntax through Babel before Vite bundles the app.
 *
 * @returns A Vite plugin that transforms TypeScript application files and skips test files.
 *
 * @example
 * ```ts
 * import { fluoDecoratorsPlugin } from '@fluojs/vite';
 * import { defineConfig } from 'vite';
 *
 * export default defineConfig({
 *   plugins: [fluoDecoratorsPlugin()],
 * });
 * ```
 */
function resolveBabelConfigFile(
  babelConfigFile: FluoDecoratorsPluginOptions['babelConfigFile'],
  filePath: string,
): false | string {
  return typeof babelConfigFile === 'function' ? babelConfigFile(filePath) : babelConfigFile ?? false;
}

function createFluoDecoratorsPlugin(
  options: FluoDecoratorsPluginOptions,
  importBabelCoreModule: BabelCoreImporter,
): Plugin {
  let shouldGenerateSourceMaps = false;
  let babelCore: BabelCoreModule | undefined;
  const transformBoundary = options.transformBoundary ?? 'application';

  return {
    name: 'fluo-babel-decorators',
    enforce: 'pre',
    configResolved(config) {
      shouldGenerateSourceMaps = shouldRequestBabelSourceMaps(config);
    },
    async transform(code: string, id: string) {
      if (!shouldTransformTypeScriptFile(id, transformBoundary)) {
        return null;
      }

      const filePath = readViteFilePath(id);
      const loadedBabelCore = babelCore ?? (await loadBabelCore(filePath, importBabelCoreModule));
      babelCore = loadedBabelCore;

      const result = await loadedBabelCore
        .transformAsync(withMetadataPreload(code), {
          babelrc: false,
          configFile: resolveBabelConfigFile(options.babelConfigFile, filePath),
          filename: filePath,
          plugins: [['@babel/plugin-proposal-decorators', { version: '2023-11' }]],
          presets: [['@babel/preset-typescript', { allowDeclareFields: true }]],
          sourceMaps: options.sourceMaps ?? shouldGenerateSourceMaps,
        })
        .catch((error: unknown) => {
          throw createBabelTransformDiagnostic(error, filePath);
        });

      if (!result?.code) {
        return null;
      }

      return { code: result.code, map: result.map ?? null };
    },
  };
}

/**
 * Creates the Vite plugin used by generated fluo starter projects to transform
 * TypeScript application files that contain TC39 standard decorators.
 *
 * @returns A Vite plugin that lazily loads Babel for eligible application `.ts` files.
 */
export function fluoDecoratorsPlugin(options: FluoDecoratorsPluginOptions = {}): Plugin {
  return createFluoDecoratorsPlugin(options, importBabelCore);
}

/**
 * Creates the fluo Vite decorators plugin with an injected Babel importer for regression tests.
 *
 * @internal
 * @param importBabelCoreModule - Async loader used instead of the production `@babel/core` dynamic import.
 * @returns A Vite plugin that preserves the production transform boundary while allowing tests to control Babel loading.
 */
export function createFluoDecoratorsPluginForTesting(importBabelCoreModule: BabelCoreImporter): Plugin {
  return createFluoDecoratorsPlugin({}, importBabelCoreModule);
}
