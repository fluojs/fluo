import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type { Constructor } from '@fluojs/core';
import { getModuleMetadata } from '@fluojs/core/internal';
import { Container, type Provider } from '@fluojs/di';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigModule } from './module.js';
import { ConfigService } from './service.js';
import type { ConfigModuleOptions } from './types.js';

const watchCallbacks = vi.hoisted(() => new Set<() => void>());

type ProcessWithGetBuiltinModule = typeof process & {
  getBuiltinModule?: typeof process.getBuiltinModule;
};

const processWithGetBuiltinModule = process as ProcessWithGetBuiltinModule;
const originalGetBuiltinModule = processWithGetBuiltinModule.getBuiltinModule?.bind(process);

function spyOnGetBuiltinModule(implementation: typeof process.getBuiltinModule): void {
  if (!processWithGetBuiltinModule.getBuiltinModule) {
    Object.defineProperty(processWithGetBuiltinModule, 'getBuiltinModule', {
      configurable: true,
      value: implementation,
      writable: true,
    });
  }

  vi.spyOn(processWithGetBuiltinModule as typeof process & { getBuiltinModule: typeof process.getBuiltinModule }, 'getBuiltinModule').mockImplementation(implementation);
}

function installNodeBuiltinMock(): void {
  spyOnGetBuiltinModule(((id: string) => {
    if (id === 'node:crypto') {
      return { createHash };
    }

    if (id === 'node:fs') {
      return {
        existsSync,
        readFileSync,
        watch,
      };
    }

    if (id === 'node:path') {
      return {
        basename,
        dirname,
        join,
      };
    }

    return originalGetBuiltinModule?.(id as Parameters<typeof process.getBuiltinModule>[0]);
  }) as typeof process.getBuiltinModule);
}

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();

  return {
    ...actual,
    watch: vi.fn((_filename, _options, listener) => {
      const callback = () => listener('change', null);
      watchCallbacks.add(callback);

      return {
        close: vi.fn(() => {
          watchCallbacks.delete(callback);
        }),
      };
    }),
  };
});

beforeEach(() => {
  installNodeBuiltinMock();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function emitWatchChange(): void {
  for (const callback of [...watchCallbacks]) {
    callback();
  }
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error('Timed out waiting for condition.');
}

type ConfigProvider = { provide?: unknown; useFactory?: () => unknown; useValue?: unknown };
type WatchManagerConstructor = new (
  config: ConfigService,
  options: ConfigModuleOptions,
) => { onApplicationBootstrap(): void; onModuleDestroy(): void };

function moduleProviders(moduleType: Constructor): Provider[] {
  const metadata = getModuleMetadata(moduleType);

  if (!metadata || !Array.isArray(metadata.providers)) {
    throw new Error('ConfigModule did not register providers metadata.');
  }

  return metadata.providers as Provider[];
}

describe('ConfigModule watch mode', () => {
  it('activates watch reloads from ConfigModule.forRoot without replacing ConfigService identity', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-module-watch-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'PORT=4000\n');

    const moduleRef = ConfigModule.forRoot({
      envFile: envPath,
      processEnv: {},
      watch: true,
    });
    const providers = moduleProviders(moduleRef) as Array<ConfigProvider | WatchManagerConstructor>;
    const watchManagerProvider = providers?.find(
      (provider): provider is WatchManagerConstructor => typeof provider === 'function' && provider.name === 'ConfigModuleWatchManager',
    );
    const container = new Container();

    container.register(...moduleProviders(moduleRef));

    const service = await container.resolve(ConfigService);
    const manager = watchManagerProvider ? await container.resolve(watchManagerProvider) : undefined;

    expect(service.get('PORT')).toBe('4000');
    expect(manager).toBeDefined();

    try {
      manager?.onApplicationBootstrap();
      manager?.onApplicationBootstrap();

      expect(watchCallbacks.size).toBe(1);

      writeFileSync(envPath, 'PORT=4100\n');
      emitWatchChange();
      await waitForCondition(() => service.get('PORT') === '4100');

      expect(service.get('PORT')).toBe('4100');
      expect(watchCallbacks.size).toBe(1);
    } finally {
      manager?.onModuleDestroy();
    }

    expect(watchCallbacks.size).toBe(0);
  });
});
