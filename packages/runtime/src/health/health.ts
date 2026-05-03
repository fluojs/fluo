import { Controller, Get } from '@fluojs/http';

import { defineModule } from '../bootstrap.js';
import type { ModuleType } from '../types.js';

/**
 * Describes the health status contract.
 */
export interface HealthStatus {
  status: 'ok' | 'unavailable';
}

/**
 * Describes the health check response contract.
 */
export interface HealthCheckResponse {
  body: unknown;
  statusCode?: number;
}

/**
 * Describes the readiness status contract.
 */
export interface ReadinessStatus {
  status: 'ready' | 'starting' | 'unavailable';
}

/**
 * Describes the health module options contract.
 */
export interface HealthModuleOptions {
  healthCheck?: (ctx: import('@fluojs/http').RequestContext) =>
    | HealthStatus
    | HealthCheckResponse
    | Promise<HealthStatus | HealthCheckResponse>;
  path?: string;
}

/**
 * Defines the readiness check type.
 */
export type ReadinessCheck = () => boolean | Promise<boolean>;

function createRuntimeHealthModule(options: HealthModuleOptions = {}): ModuleType {
  const basePath = options.path ?? '';
  const readinessChecks: ReadinessCheck[] = [];
  let ready = false;

  const resolveHealthResponse = async (
    ctx: import('@fluojs/http').RequestContext,
  ): Promise<HealthStatus | HealthCheckResponse> => {
    if (!options.healthCheck) {
      return { status: 'ok' };
    }

    return options.healthCheck(ctx);
  };

  const isHealthCheckResponse = (value: HealthStatus | HealthCheckResponse): value is HealthCheckResponse =>
    typeof value === 'object' && value !== null && 'body' in value;

  @Controller(basePath)
  class HealthController {
    @Get('/health')
    async health(_input: undefined, ctx: import('@fluojs/http').RequestContext): Promise<unknown> {
      const result = await resolveHealthResponse(ctx);

      if (isHealthCheckResponse(result)) {
        if (result.statusCode !== undefined) {
          ctx.response.setStatus(result.statusCode);
        }

        return result.body;
      }

      return result;
    }

    @Get('/ready')
    async ready(_input: undefined, ctx: import('@fluojs/http').RequestContext): Promise<ReadinessStatus> {
      if (!ready) {
        ctx.response.setStatus(503);
        return { status: 'starting' };
      }

      for (const check of readinessChecks) {
        const result = await check();

        if (!result) {
          ctx.response.setStatus(503);
          return { status: 'unavailable' };
        }
      }

      return { status: 'ready' };
    }
  }

  class RuntimeHealthModule {
    static addReadinessCheck(fn: ReadinessCheck): void {
      readinessChecks.push(fn);
    }

    static markReady(): void {
      ready = true;
    }

    static markStarting(): void {
      ready = false;
    }
  }

  Object.defineProperty(RuntimeHealthModule, 'name', {
    value: 'HealthModule',
  });

  defineModule(RuntimeHealthModule, {
    controllers: [HealthController],
  });

  return RuntimeHealthModule;
}

/**
 * Runtime health module facade for application module imports.
 */
export class HealthModule {
  /**
   * Creates a runtime-owned `/health` and `/ready` module.
   *
   * @param options Runtime health endpoint options.
   * @returns A module class that can be imported into an application module.
   */
  static forRoot(options: HealthModuleOptions = {}): ModuleType {
    return createRuntimeHealthModule(options);
  }
}

/**
 * Creates a runtime-owned `/health` and `/ready` module.
 *
 * @deprecated Prefer `HealthModule.forRoot(...)` for application-facing module registration.
 * @param options Runtime health endpoint options.
 * @returns A module class that can be imported into an application module.
 */
export function createHealthModule(options: HealthModuleOptions = {}): ModuleType {
  return HealthModule.forRoot(options);
}
