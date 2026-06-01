import type { Plugin, ResolvedConfig } from 'vite';

type BabelCoreModule = Pick<typeof import('@babel/core'), 'transformAsync'>;

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

async function loadBabelCore(filePath: string): Promise<BabelCoreModule> {
  try {
    return await import('@babel/core');
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
  return /\.(?:test|spec)\.ts$/u.test(filePath);
}

function shouldTransformTypeScriptApplicationFile(id: string): boolean {
  const normalizedFilePath = readViteFilePath(id).replaceAll('\\', '/');

  if (!normalizedFilePath.endsWith('.ts') || normalizedFilePath.endsWith('.d.ts')) {
    return false;
  }

  return !isNodeModulesPath(normalizedFilePath) && !isTypeScriptTestFile(normalizedFilePath);
}

function shouldRequestBabelSourceMaps(config: Pick<ResolvedConfig, 'build' | 'command'>): boolean {
  return config.command === 'serve' || Boolean(config.build.sourcemap);
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
export function fluoDecoratorsPlugin(): Plugin {
  let shouldGenerateSourceMaps = false;
  let babelCorePromise: Promise<BabelCoreModule> | undefined;

  return {
    name: 'fluo-babel-decorators',
    configResolved(config) {
      shouldGenerateSourceMaps = shouldRequestBabelSourceMaps(config);
    },
    async transform(code: string, id: string) {
      if (!shouldTransformTypeScriptApplicationFile(id)) {
        return null;
      }

      const filePath = readViteFilePath(id);
      babelCorePromise ??= loadBabelCore(filePath);

      const babelCore = await babelCorePromise;
      const result = await babelCore
        .transformAsync(code, {
          babelrc: false,
          configFile: false,
          filename: filePath,
          plugins: [['@babel/plugin-proposal-decorators', { version: '2023-11' }]],
          presets: [['@babel/preset-typescript', { allowDeclareFields: true }]],
          sourceMaps: shouldGenerateSourceMaps,
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
