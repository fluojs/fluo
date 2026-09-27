import { fileURLToPath } from 'node:url';
import type { PluginObj } from '@babel/core';
import type { Plugin, ResolvedConfig } from 'vite';

type BabelCoreModule = Pick<typeof import('@babel/core'), 'transformAsync' | 'version'>;
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
   * Uses a Babel config filesystem path or `file://` URL string for every eligible module,
   * or resolves either string per module from its source file path. The default `false`
   * disables Babel configuration discovery. Missing or unloadable custom configs report
   * the source and config paths with the underlying error as their cause.
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
const METADATA_PRELOAD_SOURCE = '@fluojs/core/metadata-preload';

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
  const firstLine = readErrorMessage(error).split('\n', 1)[0] ?? '';

  return (
    (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND' || firstLine.includes('Cannot find package')) &&
    BABEL_PEER_DEPENDENCIES.some((dependencyName) =>
      firstLine.includes(`Cannot find module '${dependencyName}'`) ||
      firstLine.includes(`Cannot find package '${dependencyName}'`))
  );
}

function createBabelTransformDiagnostic(error: unknown, filePath: string, configFile: false | string = false): Error {
  const message = readErrorMessage(error);
  const firstLine = message.split('\n', 1)[0] ?? '';
  const missingConfig = configFile && (readErrorCode(error) === 'MODULE_NOT_FOUND' || readErrorCode(error) === 'ERR_MODULE_NOT_FOUND')
    && firstLine.includes(`Cannot find module '${configFile}'`);

  if (missingConfig) {
    return new Error(
      `[fluo-babel-decorators] babelConfigFile not found at ${configFile} while transforming ${filePath}. Original error: ${message}`,
      { cause: error },
    );
  }

  if (isMissingPeerDependencyError(error)) {
    return new Error(
      `[fluo-babel-decorators] Failed to resolve a Babel peer dependency while transforming ${filePath}. ` +
        'Install @babel/core, @babel/plugin-proposal-decorators, and @babel/preset-typescript in the Vite project. ' +
        `Original error: ${message}`,
    );
  }

  if (configFile && (
    (error instanceof Error && error.stack?.includes(configFile)) ||
    firstLine.startsWith('Error while parsing config')
  )) {
    return new Error(
      `[fluo-babel-decorators] Failed to load babelConfigFile ${configFile} while transforming ${filePath}. Original error: ${message}`,
      { cause: error },
    );
  }

  return error instanceof Error ? error : new Error(message);
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

function createMetadataPreloadPlugin(): PluginObj {
  return {
    name: 'fluo-metadata-preload',
    visitor: {
      Program(path) {
        let hasDecorator = false;

        path.traverse({
          Decorator() {
            hasDecorator = true;
          },
        });

        const hasPreloadImport = path.node.body.some(
          (statement) =>
            statement.type === 'ImportDeclaration' && statement.source.value === METADATA_PRELOAD_SOURCE,
        );

        if (!hasDecorator || hasPreloadImport) {
          return;
        }

        path.unshiftContainer('body', {
          type: 'ImportDeclaration',
          specifiers: [],
          source: { type: 'StringLiteral', value: METADATA_PRELOAD_SOURCE },
        });
      },
    },
  };
}

function createFluoDecoratorsPreset(): { readonly plugins: readonly [PluginObj, readonly [string, { readonly version: '2023-11' }]] } {
  return {
    plugins: [createMetadataPreloadPlugin(), ['@babel/plugin-proposal-decorators', { version: '2023-11' }]],
  };
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
  const resolved = typeof babelConfigFile === 'function' ? babelConfigFile(filePath) : babelConfigFile ?? false;
  if (typeof resolved === 'string' && resolved.startsWith('file://')) {
    try {
      return fileURLToPath(resolved);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }

      throw new Error(
        `[fluo-babel-decorators] Failed to resolve babelConfigFile ${resolved} while transforming ${filePath}. Original error: ${error.message}`,
        { cause: error },
      );
    }
  }

  return resolved;
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
      const babelConfigFile = resolveBabelConfigFile(options.babelConfigFile, filePath);
      const loadedBabelCore = babelCore ?? (await loadBabelCore(filePath, importBabelCoreModule));
      babelCore = loadedBabelCore;

      const result = await loadedBabelCore
        .transformAsync(code, {
          babelrc: false,
          configFile: babelConfigFile,
          filename: filePath,
          plugins: babelConfigFile ? [createMetadataPreloadPlugin()] : [],
          presets: babelConfigFile
            ? []
            : [
                createFluoDecoratorsPreset,
                loadedBabelCore.version.startsWith('7.')
                  ? ['@babel/preset-typescript', { allowDeclareFields: true }]
                  : '@babel/preset-typescript',
              ],
          sourceMaps: options.sourceMaps ?? shouldGenerateSourceMaps,
        })
        .catch((error: unknown) => {
          throw createBabelTransformDiagnostic(error, filePath, babelConfigFile);
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
 * @param options - Configuration for the decorator transform boundary, Babel configuration, and source maps.
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
