import { existsSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';

import { transformAsync } from '@babel/core';

const babelConfigFileCache = new Map<string, string>();
const babelConfigFileNames = ['babel.config.cjs', 'babel.config.mjs', 'babel.config.js', 'babel.config.json'] as const;

function normalizeTransformId(id: string): string {
  const withoutQuery = id.split(/[?#]/, 1)[0] ?? id;

  return withoutQuery.startsWith('\0') ? withoutQuery.slice(1) : withoutQuery;
}

function isNodeModulesPath(filePath: string): boolean {
  return /(?:^|[/\\])node_modules(?:[/\\]|$)/.test(filePath);
}

function isTypeScriptSource(filePath: string): boolean {
  return ['.cts', '.mts', '.ts', '.tsx'].includes(extname(filePath));
}

/**
 * Resolves the nearest Babel root configuration file starting from the given file path
 * and searching upwards through the directory hierarchy.
 *
 * @param filePath - The path to the file whose nearest Babel configuration should be found.
 * @returns The absolute path to the nearest Babel root configuration file.
 * @throws Error if no configuration file can be located.
 */
export function resolveNearestBabelConfigFile(filePath: string): string {
  let currentDirectory = dirname(normalizeTransformId(filePath));

  while (true) {
    const cachedConfigFile = babelConfigFileCache.get(currentDirectory);

    if (cachedConfigFile) {
      return cachedConfigFile;
    }

    for (const configFileName of babelConfigFileNames) {
      const configFile = join(currentDirectory, configFileName);

      if (existsSync(configFile)) {
        babelConfigFileCache.set(currentDirectory, configFile);
        return configFile;
      }
    }

    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      throw new Error(`Unable to locate a Babel root config (${babelConfigFileNames.join(', ')}) for ${filePath}.`);
    }

    currentDirectory = parentDirectory;
  }
}

/**
 * Creates a Babel transformation plugin that handles fluo decorator syntax
 * during the testing process.
 *
 * @param resolveConfigFile - A function that resolves the Babel configuration file path for a given file.
 * @returns A transformation plugin compatible with testing tools like Vitest.
 */
export function createFluoBabelDecoratorsPlugin(
  resolveConfigFile: (filePath: string) => string,
){
  return {
    name: 'fluo-babel-decorators',
    async transform(code: string, id: string) {
      const filePath = normalizeTransformId(id);

      if (!isTypeScriptSource(filePath) || isNodeModulesPath(filePath)) {
        return null;
      }

      const result = await transformAsync(code, {
        babelrc: false,
        configFile: resolveConfigFile(filePath),
        filename: filePath,
        sourceMaps: true,
      });

      if (!result?.code) {
        return null;
      }

      return {
        code: result.code,
        map: result.map ?? null,
      };
    },
  };
}

/**
 * Re-export type for the fluo Babel decorators plugin.
 */
export type FluoBabelDecoratorsPlugin = ReturnType<typeof createFluoBabelDecoratorsPlugin>;
