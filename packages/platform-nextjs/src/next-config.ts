import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

type TurbopackRules = NonNullable<
  NonNullable<NextConfig['turbopack']>['rules']
>;
type TurbopackRuleCollection = TurbopackRules[string];

const decoratorsLoaderPath = fileURLToPath(
  new URL('../decorators-loader.cjs', import.meta.url),
);
const fluoDecoratorsRule = {
  as: '*.js',
  condition: {
    all: [
      { not: 'foreign' },
      { not: 'browser' },
      { content: /@\w+/u },
    ],
  },
  loaders: [
    {
      loader: decoratorsLoaderPath,
    },
  ],
} satisfies TurbopackRuleCollection;

function appendDecoratorsRule(
  existingRule: TurbopackRuleCollection | undefined,
): TurbopackRuleCollection {
  if (existingRule === undefined) {
    return fluoDecoratorsRule;
  }

  if (Array.isArray(existingRule)) {
    return [...existingRule, fluoDecoratorsRule];
  }

  return [existingRule, fluoDecoratorsRule];
}

/**
 * Add the packaged Fluo decorator loader to a Next.js Turbopack config.
 *
 * Existing Next options and Turbopack rules are copied into the returned
 * object. The input object is never mutated.
 *
 * @param config Existing Next.js configuration.
 * @returns A Next.js configuration with server TypeScript decorators enabled.
 */
export function withFluoNextBackend(
  config: NextConfig = {},
): NextConfig {
  const turbopack = config.turbopack ?? {};
  const rules = turbopack.rules ?? {};

  return {
    ...config,
    turbopack: {
      ...turbopack,
      rules: {
        ...rules,
        '*.ts': appendDecoratorsRule(rules['*.ts']),
      },
    },
  };
}
