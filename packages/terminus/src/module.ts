import type { Provider } from '@fluojs/di';
import type { RequestContext } from '@fluojs/http';
import {
  createHealthModule,
  defineModule,
  type ModuleType,
  type PlatformHealthReport,
  type PlatformReadinessReport,
} from '@fluojs/runtime';
import { PLATFORM_SHELL, RUNTIME_CONTAINER } from '@fluojs/runtime/internal';

import { TerminusHealthService } from './health-check.js';
import { TERMINUS_HEALTH_INDICATORS, TERMINUS_INDICATOR_PROVIDER_TOKENS } from './tokens.js';
import type { HealthCheckReport, HealthIndicator, HealthIndicatorState, TerminusModuleOptions } from './types.js';

const TERMINUS_OPTIONS = Symbol.for('fluo.terminus.options');

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

function createTerminusProviders(options: TerminusModuleOptions = {}): Provider[] {
  const normalizedOptions: TerminusModuleOptions = {
    ...options,
    execution: { ...(options.execution ?? {}) },
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
    {
      inject: [TERMINUS_HEALTH_INDICATORS, TERMINUS_OPTIONS],
      provide: TerminusHealthService,
      useFactory: (resolvedIndicators: unknown, resolvedOptions: unknown) => {
        const indicators = Array.isArray(resolvedIndicators) ? (resolvedIndicators as readonly HealthIndicator[]) : [];
        const execution = typeof resolvedOptions === 'object'
          && resolvedOptions !== null
          && 'execution' in resolvedOptions
          && typeof (resolvedOptions as { execution?: unknown }).execution === 'object'
          && (resolvedOptions as { execution?: unknown }).execution !== null
          ? ((resolvedOptions as { execution?: TerminusModuleOptions['execution'] }).execution ?? {})
          : {};

        return new TerminusHealthService(indicators, execution);
      },
    },
  ];
}

function createPlatformHealthDiagnostic(health: PlatformHealthReport): HealthIndicatorState | undefined {
  if (health.status === 'healthy') {
    return undefined;
  }

  return {
    checks: health.checks,
    message: health.reason ?? `Platform health reported ${health.status}.`,
    platformStatus: health.status,
    status: 'down',
  };
}

function createPlatformReadinessDiagnostic(readiness: PlatformReadinessReport): HealthIndicatorState | undefined {
  if (readiness.status === 'ready') {
    return undefined;
  }

  return {
    checks: readiness.checks,
    critical: readiness.critical,
    message: readiness.reason ?? `Platform readiness reported ${readiness.status}.`,
    platformStatus: readiness.status,
    status: 'down',
  };
}

function withPlatformDiagnostics(
  report: HealthCheckReport,
  health: PlatformHealthReport,
  readiness: PlatformReadinessReport,
): HealthCheckReport {
  const platformDiagnostics: Record<string, HealthIndicatorState> = {};
  const healthDiagnostic = createPlatformHealthDiagnostic(health);
  const readinessDiagnostic = createPlatformReadinessDiagnostic(readiness);

  if (healthDiagnostic !== undefined) {
    platformDiagnostics['fluo-platform-health'] = healthDiagnostic;
  }

  if (readinessDiagnostic !== undefined) {
    platformDiagnostics['fluo-platform-readiness'] = readinessDiagnostic;
  }

  const platformDiagnosticKeys = Object.keys(platformDiagnostics);

  return {
    ...report,
    contributors: {
      down: [...report.contributors.down, ...platformDiagnosticKeys],
      up: [...report.contributors.up],
    },
    details: {
      ...report.details,
      ...platformDiagnostics,
    },
    error: {
      ...report.error,
      ...platformDiagnostics,
    },
    platform: {
      health,
      readiness,
    },
    status: report.status === 'ok' && platformDiagnosticKeys.length === 0 ? 'ok' : 'error',
  };
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
      const reportWithPlatform = withPlatformDiagnostics(report, health, readiness);

      return {
        body: reportWithPlatform,
        statusCode: reportWithPlatform.status === 'ok' ? 200 : 503,
      };
    },
    path: options.path,
  }) as ReadinessManagedModule;

  for (const check of readinessChecks) {
    healthModule.addReadinessCheck(check);
  }

  const TERMINUS_READINESS_REGISTRAR = Symbol('fluo.terminus.readiness-registrar');

  class TerminusRuntimeModule {}

  return defineModule(TerminusRuntimeModule, {
    exports: [TERMINUS_HEALTH_INDICATORS, TerminusHealthService],
    imports: [healthModule],
    providers: [
      ...createTerminusProviders({
        execution: options.execution,
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

/** Module entry point that wires Terminus indicators into runtime health endpoints. */
export class TerminusModule {
  /**
   * Register Terminus health indicators and readiness hooks.
   *
   * @example
   * ```ts
   * TerminusModule.forRoot({
   *   indicators: [new MemoryHealthIndicator({ key: 'memory' })],
   * });
   * ```
   *
   * @param options Terminus health indicator and readiness configuration.
   * @returns A runtime module exposing health endpoints and `TerminusHealthService`.
   */
  static forRoot(options: TerminusModuleOptions = {}): ModuleType {
    return createTerminusRuntimeModule(options);
  }
}
