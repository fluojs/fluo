import { fileURLToPath } from 'node:url';

import type { NextConfig } from 'next';

type TurbopackRules = NonNullable<
  NonNullable<NextConfig['turbopack']>['rules']
>;
type TurbopackRuleCollection = TurbopackRules[string];

const decoratorsLoaderPath = fileURLToPath(
  new URL('../decorators-loader.cjs', import.meta.url),
);

/** Opt-in compiler scope and output identity for the Next.js backend helper. */
export interface FluoNextBackendOptions {
  /** Turbopack project-relative path glob or regular expression to include. */
  readonly include?: string | RegExp;
  /** Turbopack project-relative path glob or regular expression to exclude. */
  readonly exclude?: string | RegExp;
  /** Keep the original `.ts` module path instead of renaming output to `.js`. */
  readonly preserveModulePaths?: boolean;
}

function appendDecoratorsRule(
  existingRule: TurbopackRuleCollection | undefined,
  options: FluoNextBackendOptions,
): TurbopackRuleCollection {
  const fluoDecoratorsRule = {
    ...(options.preserveModulePaths ? {} : { as: '*.js' }),
    condition: {
      all: [
        { not: 'foreign' },
        { not: 'browser' },
        { content: /@\w+/u },
        ...(options.include === undefined ? [] : [{ path: options.include }]),
        ...(options.exclude === undefined ? [] : [{ not: { path: options.exclude } }]),
      ],
    },
    loaders: [{ loader: decoratorsLoaderPath }],
  } satisfies TurbopackRuleCollection;

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
 * Scope conditions are combined with the existing server/application/content
 * guards. Path-preserving output remains JavaScript parsed under the original
 * TypeScript filename; no version-specific Turbopack module type is forced.
 *
 * @param config Existing Next.js configuration.
 * @param options Optional path scope and module-path preservation; omission keeps legacy output.
 * @returns A Next.js configuration with server TypeScript decorators enabled.
 */
export function withFluoNextBackend(
  config: NextConfig = {},
  options: FluoNextBackendOptions = {},
): NextConfig {
  const turbopack = config.turbopack ?? {};
  const rules = turbopack.rules ?? {};

  return {
    ...config,
    turbopack: {
      ...turbopack,
      rules: {
        ...rules,
        '*.ts': appendDecoratorsRule(rules['*.ts'], options),
      },
    },
  };
}
