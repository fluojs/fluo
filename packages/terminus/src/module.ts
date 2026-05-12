import type { Token } from '@fluojs/core';
import type { Provider } from '@fluojs/di';
import type { RequestContext } from '@fluojs/http';
import {
  defineModule,
  HealthModule,
  type ModuleType,
  PLATFORM_SHELL,
  type PlatformHealthReport,
  type PlatformReadinessReport,
} from '@fluojs/runtime';

import { TerminusHealthService } from './health-check.js';
import { TERMINUS_HEALTH_INDICATORS, TERMINUS_INDICATOR_PROVIDER_TOKENS } from './tokens.js';
import type { HealthCheckReport, HealthIndicator, HealthIndicatorState, TerminusModuleOptions } from './types.js';

const TERMINUS_OPTIONS = Symbol.for('fluo.terminus.options');

type ReadinessManagedModule = ReturnType<typeof HealthModule.forRoot> & {
  addReadinessCheck(fn: (ctx: RequestContext) => boolean | Promise<boolean>): void;
};

function copyIndicators(indicators: readonly HealthIndicator[] | undefined): HealthIndicator[] {
  return [...(indicators ?? [])];
}

function copyProviders(providers: readonly Provider[] | undefined): Provider[] {
  return [...(providers ?? [])];
}

function providerToken(provider: Provider): Token | undefined {
  if (typeof provider === 'function') {
    return provider as Token;
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
    readiness: options.readiness === undefined
      ? undefined
      : {
          indicatorKeys: options.readiness.indicatorKeys === undefined
            ? undefined
            : [...options.readiness.indicatorKeys],
        },
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
      inject: [TERMINUS_OPTIONS, ...indicatorProviderTokens],
      provide: TERMINUS_HEALTH_INDICATORS,
      useFactory: (resolvedOptions: unknown, ...resolvedProviderIndicators: unknown[]) => {
        const resolvedIndicators: HealthIndicator[] = [];

        if (typeof resolvedOptions === 'object' && resolvedOptions !== null && 'indicators' in resolvedOptions) {
          const indicators = (resolvedOptions as { indicators?: readonly HealthIndicator[] }).indicators;
          resolvedIndicators.push(...copyIndicators(indicators));
        }

        for (const providerIndicator of resolvedProviderIndicators) {
          resolvedIndicators.push(providerIndicator as HealthIndicator);
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

function createPlatformDiagnosticCollisionKey(
  diagnosticKey: string,
  seenKeys: ReadonlySet<string>,
): string {
  const baseKey = `${diagnosticKey}-duplicate-key-error`;

  if (!seenKeys.has(baseKey)) {
    return baseKey;
  }

  let suffix = 2;
  let candidate = `${baseKey}-${String(suffix)}`;

  while (seenKeys.has(candidate)) {
    suffix += 1;
    candidate = `${baseKey}-${String(suffix)}`;
  }

  return candidate;
}

function appendPlatformDiagnostic(
  entries: Record<string, HealthIndicatorState>,
  existingKeys: ReadonlySet<string>,
  diagnosticKey: string,
  diagnostic: HealthIndicatorState | undefined,
): void {
  if (diagnostic === undefined) {
    return;
  }

  if (!existingKeys.has(diagnosticKey) && !(diagnosticKey in entries)) {
    entries[diagnosticKey] = diagnostic;
    return;
  }

  const collisionKey = createPlatformDiagnosticCollisionKey(diagnosticKey, new Set([
    ...existingKeys,
    ...Object.keys(entries),
  ]));
  entries[collisionKey] = {
    message: `Platform diagnostic key "${diagnosticKey}" collided with an existing health result key.`,
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
  const existingKeys = new Set(Object.keys(report.details));

  appendPlatformDiagnostic(platformDiagnostics, existingKeys, 'fluo-platform-health', healthDiagnostic);
  appendPlatformDiagnostic(platformDiagnostics, existingKeys, 'fluo-platform-readiness', readinessDiagnostic);

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
  const healthModule = HealthModule.forRoot({
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
        inject: [TerminusHealthService],
        provide: TERMINUS_READINESS_REGISTRAR,
        useFactory: (resolvedHealthService: unknown) => {
          const healthService = resolvedHealthService as TerminusHealthService;
          const readinessIndicatorKeys = options.readiness?.indicatorKeys === undefined
            ? undefined
            : [...options.readiness.indicatorKeys];

          return {
            onApplicationBootstrap(): void {
              healthModule.addReadinessCheck(async (ctx: RequestContext) => {
                const platformShell = await ctx.container.resolve(PLATFORM_SHELL);
                const [indicatorHealthy, readiness] = await Promise.all([
                  healthService.isReady(readinessIndicatorKeys),
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
   * import { MemoryHealthIndicator } from '@fluojs/terminus/node';
   *
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
