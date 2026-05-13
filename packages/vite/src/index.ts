import { transformAsync } from '@babel/core';
import type { Plugin } from 'vite';

function shouldTransformTypeScriptApplicationFile(id: string): boolean {
  const [filePath] = id.split('?', 1);
  const normalizedFilePath = filePath.replaceAll('\\', '/');

  if (!normalizedFilePath.endsWith('.ts') || normalizedFilePath.endsWith('.d.ts')) {
    return false;
  }

  return (
    !normalizedFilePath.includes('/node_modules/') &&
    !normalizedFilePath.includes('.test.') &&
    !normalizedFilePath.includes('.spec.')
  );
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
  return {
    name: 'fluo-babel-decorators',
    async transform(code: string, id: string) {
      if (!shouldTransformTypeScriptApplicationFile(id)) {
        return null;
      }

      const [filename] = id.split('?', 1);

      const result = await transformAsync(code, {
        babelrc: false,
        configFile: false,
        filename,
        plugins: [['@babel/plugin-proposal-decorators', { version: '2023-11' }]],
        presets: [['@babel/preset-typescript', { allowDeclareFields: true }]],
        sourceMaps: true,
      });

      if (!result?.code) {
        return null;
      }

      return { code: result.code, map: result.map ?? null };
    },
  };
}
