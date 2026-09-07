import { createRequire } from 'node:module';

import {
  type TransformOptions,
  transformAsync,
} from '@babel/core';

const require = createRequire(import.meta.url);
const decoratorsPluginPath = require.resolve(
  '@babel/plugin-proposal-decorators',
);
const typescriptPresetPath = require.resolve('@babel/preset-typescript');

/** Result returned to the packaged Turbopack decorator loader. */
export interface FluoDecoratorsTransformResult {
  readonly code: string;
  readonly map: unknown;
}

/** Babel completed without emitting JavaScript for a Fluo backend file. */
export class FluoDecoratorsTransformError extends Error {
  /**
   * Create a missing-output transform error.
   *
   * @param filePath TypeScript application file that produced no JavaScript.
   */
  constructor(readonly filePath: string) {
    super(`Fluo decorator transform emitted no JavaScript for ${filePath}.`);
    this.name = 'FluoDecoratorsTransformError';
  }
}

/**
 * Compile one TypeScript application file with Fluo's standard decorator
 * transform.
 *
 * @param source TypeScript source supplied by Turbopack.
 * @param filePath Absolute application source path.
 * @param inputSourceMap Optional source map supplied by an earlier loader.
 * @returns JavaScript and its source map.
 */
export async function transformFluoDecorators(
  source: string,
  filePath: string,
  inputSourceMap?: TransformOptions['inputSourceMap'],
): Promise<FluoDecoratorsTransformResult> {
  const result = await transformAsync(source, {
    babelrc: false,
    configFile: false,
    filename: filePath,
    inputSourceMap,
    plugins: [[decoratorsPluginPath, { version: '2023-11' }]],
    presets: [[typescriptPresetPath, { allowDeclareFields: true }]],
    sourceMaps: true,
  });

  if (!result?.code) {
    throw new FluoDecoratorsTransformError(filePath);
  }

  return {
    code: result.code,
    map: result.map ?? null,
  };
}
