import { Controller, Get } from '@konekti/http';

import { defineModule } from './bootstrap.js';
import type { ModuleType } from './types.js';

export interface HealthStatus {
  status: 'ok' | 'unavailable';
}

export interface ReadinessStatus {
  status: 'ready' | 'unavailable';
}

export interface HealthModuleOptions {
  path?: string;
}

export function createHealthModule(options: HealthModuleOptions = {}): ModuleType {
  const basePath = options.path ?? '';

  @Controller(basePath)
  class HealthController {
    @Get('/health')
    health(): HealthStatus {
      return { status: 'ok' };
    }

    @Get('/ready')
    ready(): ReadinessStatus {
      return { status: 'ready' };
    }
  }

  class HealthModule {}

  defineModule(HealthModule, {
    controllers: [HealthController],
  });

  return HealthModule;
}
