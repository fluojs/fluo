import { transformAsync } from '@babel/core';
import type { Plugin, ResolvedConfig } from 'vite';

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

  return {
    name: 'fluo-babel-decorators',
    configResolved(config) {
      shouldGenerateSourceMaps = shouldRequestBabelSourceMaps(config);
    },
    async transform(code: string, id: string) {
      if (!shouldTransformTypeScriptApplicationFile(id)) {
        return null;
      }

      const result = await transformAsync(code, {
        babelrc: false,
        configFile: false,
        filename: readViteFilePath(id),
        plugins: [['@babel/plugin-proposal-decorators', { version: '2023-11' }]],
        presets: [['@babel/preset-typescript', { allowDeclareFields: true }]],
        sourceMaps: shouldGenerateSourceMaps,
      });

      if (!result?.code) {
        return null;
      }

      return { code: result.code, map: result.map ?? null };
    },
  };
}
