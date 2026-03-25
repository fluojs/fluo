import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { transformAsync } from '@babel/core';

const babelConfigFileCache = new Map<string, string>();

interface BabelDecoratorsTransformResult {
  code: string;
  map: unknown;
}

interface KonektiBabelDecoratorsPlugin {
  name: string;
  transform(code: string, id: string): Promise<BabelDecoratorsTransformResult | null>;
}

function resolveBabelConfigFile(filePath: string): string {
  let currentDirectory = dirname(filePath);

  while (true) {
    const cachedConfigFile = babelConfigFileCache.get(currentDirectory);

    if (cachedConfigFile) {
      return cachedConfigFile;
    }

    const configFile = join(currentDirectory, 'babel.config.cjs');

    if (existsSync(configFile)) {
      babelConfigFileCache.set(currentDirectory, configFile);
      return configFile;
    }

    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      throw new Error(`Unable to locate babel.config.cjs for ${filePath}.`);
    }

    currentDirectory = parentDirectory;
  }
}

export function konektiBabelDecoratorsPlugin(): KonektiBabelDecoratorsPlugin {
  return {
    name: 'konekti-babel-decorators',
    async transform(code: string, id: string) {
      if (!id.endsWith('.ts') || id.includes('/node_modules/')) {
        return null;
      }

      const result = await transformAsync(code, {
        babelrc: false,
        configFile: resolveBabelConfigFile(id),
        filename: id,
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
