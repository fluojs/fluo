import { Controller, Get } from '@konekti/http';

import { defineModule } from './bootstrap.js';
import type { ModuleType } from './types.js';

export interface HealthStatus {
  status: 'ok' | 'unavailable';
}

export interface HealthCheckResponse {
  body: unknown;
  statusCode?: number;
}

export interface ReadinessStatus {
  status: 'ready' | 'starting' | 'unavailable';
}

export interface HealthModuleOptions {
  healthCheck?: (ctx: import('@konekti/http').RequestContext) =>
    | HealthStatus
    | HealthCheckResponse
    | Promise<HealthStatus | HealthCheckResponse>;
  path?: string;
}

export type ReadinessCheck = () => boolean | Promise<boolean>;

export function createHealthModule(options: HealthModuleOptions = {}): ModuleType {
  const basePath = options.path ?? '';
  const readinessChecks: ReadinessCheck[] = [];
  let ready = false;

  const resolveHealthResponse = async (
    ctx: import('@konekti/http').RequestContext,
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
    async health(_input: undefined, ctx: import('@konekti/http').RequestContext): Promise<unknown> {
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
    async ready(_input: undefined, ctx: import('@konekti/http').RequestContext): Promise<ReadinessStatus> {
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

  class HealthModule {
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

  defineModule(HealthModule, {
    controllers: [HealthController],
  });

  return HealthModule;
}
