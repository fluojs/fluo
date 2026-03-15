import { Controller, Get } from '@konekti/http';

import { defineModule } from './bootstrap.js';
import type { ModuleType } from './types.js';

export interface HealthStatus {
  status: 'ok' | 'unavailable';
}

export interface ReadinessStatus {
  status: 'ready' | 'starting' | 'unavailable';
}

export interface HealthModuleOptions {
  path?: string;
}

export type ReadinessCheck = () => boolean | Promise<boolean>;

export function createHealthModule(options: HealthModuleOptions = {}): ModuleType {
  const basePath = options.path ?? '';
  const readinessChecks: ReadinessCheck[] = [];
  let ready = false;

  @Controller(basePath)
  class HealthController {
    @Get('/health')
    health(): HealthStatus {
      return { status: 'ok' };
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
