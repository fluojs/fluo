import type { Provider } from '@konekti/di';
import type { RequestContext } from '@konekti/http';
import { RUNTIME_CONTAINER, createHealthModule, defineModule, type ModuleType } from '@konekti/runtime';

import { TerminusHealthService } from './health-check.js';
import { TERMINUS_HEALTH_INDICATORS, TERMINUS_INDICATOR_PROVIDER_TOKENS, TERMINUS_OPTIONS } from './tokens.js';
import type { HealthIndicator, TerminusModuleOptions } from './types.js';

type ReadinessManagedModule = ReturnType<typeof createHealthModule> & {
  addReadinessCheck(fn: () => boolean | Promise<boolean>): void;
};

function copyIndicators(indicators: readonly HealthIndicator[] | undefined): HealthIndicator[] {
  return [...(indicators ?? [])];
}

function copyProviders(providers: readonly Provider[] | undefined): Provider[] {
  return [...(providers ?? [])];
}

function providerToken(provider: Provider): unknown {
  if (typeof provider === 'function') {
    return provider;
  }

  if ('provide' in provider) {
    return provider.provide;
  }

  return undefined;
}

export function createTerminusProviders(options: TerminusModuleOptions = {}): Provider[] {
  const normalizedOptions: TerminusModuleOptions = {
    ...options,
    indicators: copyIndicators(options.indicators),
    indicatorProviders: copyProviders(options.indicatorProviders),
    readinessChecks: [...(options.readinessChecks ?? [])],
  };
  const indicatorProviders = copyProviders(normalizedOptions.indicatorProviders);
  const indicatorProviderTokens = indicatorProviders
    .map((provider) => providerToken(provider))
    .filter((token): token is Exclude<typeof token, undefined> => token !== undefined);

  return [
    {
      provide: TERMINUS_OPTIONS,
      useValue: normalizedOptions,
    },
    {
      provide: TERMINUS_INDICATOR_PROVIDER_TOKENS,
      useValue: indicatorProviderTokens,
    },
    {
      inject: [TERMINUS_OPTIONS, TERMINUS_INDICATOR_PROVIDER_TOKENS, RUNTIME_CONTAINER],
      provide: TERMINUS_HEALTH_INDICATORS,
      useFactory: async (resolvedOptions: unknown, registeredTokens: unknown, runtimeContainer: unknown) => {
        const resolvedIndicators: HealthIndicator[] = [];

        if (typeof resolvedOptions === 'object' && resolvedOptions !== null && 'indicators' in resolvedOptions) {
          const indicators = (resolvedOptions as { indicators?: readonly HealthIndicator[] }).indicators;
          resolvedIndicators.push(...copyIndicators(indicators));
        }

        if (
          runtimeContainer
          && typeof runtimeContainer === 'object'
          && runtimeContainer !== null
          && 'resolve' in runtimeContainer
          && typeof (runtimeContainer as { resolve?: unknown }).resolve === 'function'
          && Array.isArray(registeredTokens)
        ) {
          for (const token of registeredTokens) {
            resolvedIndicators.push(await (runtimeContainer as { resolve(token: unknown): Promise<HealthIndicator> }).resolve(token));
          }
        }

        return resolvedIndicators;
      },
    },
    ...indicatorProviders,
    TerminusHealthService,
  ];
}

export function createTerminusModule(options: TerminusModuleOptions = {}): ModuleType {
  const readinessChecks = [...(options.readinessChecks ?? [])];
  const healthModule = createHealthModule({
    healthCheck: async (ctx: RequestContext) => {
      const healthService = await ctx.container.resolve(TerminusHealthService);
      const report = await healthService.check();

      return {
        body: report,
        statusCode: report.status === 'ok' ? 200 : 503,
      };
    },
    path: options.path,
  }) as ReadinessManagedModule;

  for (const check of readinessChecks) {
    healthModule.addReadinessCheck(check);
  }

  const TERMINUS_READINESS_REGISTRAR = Symbol('konekti.terminus.readiness-registrar');

  class TerminusModule {}

  return defineModule(TerminusModule, {
    exports: [TERMINUS_OPTIONS, TERMINUS_HEALTH_INDICATORS, TerminusHealthService],
    imports: [healthModule],
    providers: [
      ...createTerminusProviders({
        indicatorProviders: options.indicatorProviders,
        indicators: options.indicators,
        path: options.path,
        readinessChecks,
      }),
      {
        inject: [TerminusHealthService],
        provide: TERMINUS_READINESS_REGISTRAR,
        useFactory: (...deps: unknown[]) => {
          const [healthService] = deps as [TerminusHealthService];

          return {
            onApplicationBootstrap() {
              healthModule.addReadinessCheck(async () => healthService.isHealthy());
            },
          };
        },
      },
    ],
  });
}
