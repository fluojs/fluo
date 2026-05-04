import { transformAsync } from '@babel/core';
import type { Plugin } from 'vite';

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
      if (!id.endsWith('.ts') || id.includes('.test.')) {
        return null;
      }

      const result = await transformAsync(code, {
        babelrc: false,
        configFile: false,
        filename: id,
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
