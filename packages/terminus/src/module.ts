import type { Provider } from '@konekti/di';
import type { RequestContext } from '@konekti/http';
import {
  createHealthModule,
  defineModule,
  type ModuleType,
  type PlatformHealthReport,
  type PlatformReadinessReport,
} from '@konekti/runtime';
import { PLATFORM_SHELL, RUNTIME_CONTAINER } from '@konekti/runtime/internal';

import { TerminusHealthService } from './health-check.js';
import { TERMINUS_HEALTH_INDICATORS, TERMINUS_INDICATOR_PROVIDER_TOKENS } from './tokens.js';
import type { HealthIndicator, TerminusModuleOptions } from './types.js';

const TERMINUS_OPTIONS = Symbol.for('konekti.terminus.options');

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

function createTerminusRuntimeModule(options: TerminusModuleOptions = {}): ModuleType {
  const readinessChecks = [...(options.readinessChecks ?? [])];
  const healthModule = createHealthModule({
    healthCheck: async (ctx: RequestContext) => {
      const healthService = await ctx.container.resolve(TerminusHealthService);
      const platformShell = await ctx.container.resolve(PLATFORM_SHELL);
      const [report, readiness, health] = await Promise.all([
        healthService.check(),
        platformShell.ready(),
        platformShell.health(),
      ]);
      const status = report.status === 'ok' && health.status === 'healthy' && readiness.status === 'ready' ? 'ok' : 'error';

      return {
        body: {
          ...report,
          platform: {
            health,
            readiness,
          },
          status,
        },
        statusCode: status === 'ok' ? 200 : 503,
      };
    },
    path: options.path,
  }) as ReadinessManagedModule;

  for (const check of readinessChecks) {
    healthModule.addReadinessCheck(check);
  }

  const TERMINUS_READINESS_REGISTRAR = Symbol('konekti.terminus.readiness-registrar');

  class TerminusRuntimeModule {}

  return defineModule(TerminusRuntimeModule, {
    exports: [TERMINUS_HEALTH_INDICATORS, TerminusHealthService],
    imports: [healthModule],
    providers: [
      ...createTerminusProviders({
        indicatorProviders: options.indicatorProviders,
        indicators: options.indicators,
        path: options.path,
        readinessChecks,
      }),
      {
        inject: [TerminusHealthService, RUNTIME_CONTAINER],
        provide: TERMINUS_READINESS_REGISTRAR,
        useFactory: (...deps: unknown[]) => {
          const [healthService, runtimeContainer] = deps as [{
            isHealthy(): Promise<boolean>;
          }, {
            resolve(token: unknown): Promise<{
              ready(): Promise<PlatformReadinessReport>;
              health(): Promise<PlatformHealthReport>;
            }>;
          }];

          return {
            onApplicationBootstrap(): void {
              healthModule.addReadinessCheck(async () => {
                const platformShell = await runtimeContainer.resolve(PLATFORM_SHELL);
                const [indicatorHealthy, readiness] = await Promise.all([
                  healthService.isHealthy(),
                  platformShell.ready(),
                ]);

                return indicatorHealthy && readiness.status === 'ready';
              });
            },
          };
        },
      },
    ],
  });
}

export class TerminusModule {
  static forRoot(options: TerminusModuleOptions = {}): ModuleType {
    return createTerminusRuntimeModule(options);
  }
}
