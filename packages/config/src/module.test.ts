import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Constructor } from '@fluojs/core';
import { getModuleMetadata } from '@fluojs/core/internal';
import { Container, type Provider } from '@fluojs/di';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CONFIG_RELOADER, ConfigModule } from './module.js';
import { ConfigService } from './service.js';
import type { ConfigDictionary, ConfigModuleOptions, ConfigReloader, ConfigReloadReason } from './types.js';

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
        resolve,
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
  vi.useFakeTimers();
  installNodeBuiltinMock();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function emitWatchChange(): void {
  for (const callback of [...watchCallbacks]) {
    callback();
  }
}

async function expectWatchReload(reloader: ConfigReloader, trigger: () => void, predicate: (snapshot: ConfigDictionary, reason: string) => boolean): Promise<void> {
  const signal = new Promise<void>((resolve) => {
    const subscription = reloader.subscribe((snapshot, reason) => { if (predicate(snapshot, reason)) { subscription.unsubscribe(); resolve(); } });
  });
  trigger();
  await vi.runOnlyPendingTimersAsync();
  await signal;
}


type ConfigProvider = { provide?: unknown; useFactory?: () => unknown; useValue?: unknown };
type WatchManagerConstructor = new (
  config: ConfigService,
  options: ConfigModuleOptions,
) => ConfigReloader & { onApplicationBootstrap(): void; onModuleDestroy(): void };

function moduleProviders(moduleType: Constructor): Provider[] {
  const metadata = getModuleMetadata(moduleType);

  if (!metadata || !Array.isArray(metadata.providers)) {
    throw new Error('ConfigModule did not register providers metadata.');
  }

  return metadata.providers as Provider[];
}

describe('ConfigModule registration', () => {
  it('applies the registration-time runtime overrides snapshot above lower-precedence sources', async () => {
    const runtimeOverrides = { PORT: '4100' };
    const moduleRef = ConfigModule.forRoot({
      defaults: { PORT: '3000' },
      processEnv: { PORT: '4000' },
      runtimeOverrides,
    });
    const container = new Container();

    runtimeOverrides.PORT = '4200';
    container.register(...moduleProviders(moduleRef));

    const service = await container.resolve(ConfigService);

    expect(service.get('PORT')).toBe('4100');
  });

  it('owns the injectable manual reload contract without ConfigReloadModule', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-module-reload-owner-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'PORT=4000\n');

    const moduleRef = ConfigModule.forRoot({
      envFilePaths: [envPath],
      processEnv: {},
    });
    const container = new Container();

    container.register(...moduleProviders(moduleRef));

    const service = await container.resolve(ConfigService);
    const reloader = await container.resolve<ConfigReloader>(CONFIG_RELOADER);
    const updates: string[] = [];
    const subscription = reloader.subscribe((snapshot: ConfigDictionary, reason: ConfigReloadReason) => {
      if (reason === 'manual' && typeof snapshot['PORT'] === 'string') {
        updates.push(snapshot['PORT']);
      }
    });

    writeFileSync(envPath, 'PORT=4100\n');

    expect(reloader.reload()['PORT']).toBe('4100');
    expect(service.get('PORT')).toBe('4100');
    expect(updates).toEqual(['4100']);

    subscription.unsubscribe();
    reloader.close();
  });
});

describe('ConfigModule watch mode', () => {
  it('activates watch reloads from ConfigModule.forRoot without replacing ConfigService identity', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-module-watch-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'PORT=4000\n');

    const moduleRef = ConfigModule.forRoot({
      envFilePaths: [envPath],
      processEnv: {},
      watch: true,
    });
    const providers = moduleProviders(moduleRef) as Array<ConfigProvider | WatchManagerConstructor>;
    const watchManagerProvider = providers?.find(
      (provider): provider is WatchManagerConstructor => typeof provider === 'function' && provider.name === 'ConfigReloadManager',
    );
    const container = new Container();

    container.register(...moduleProviders(moduleRef));

    const service = await container.resolve(ConfigService);
    const manager = watchManagerProvider ? await container.resolve(watchManagerProvider) : undefined;

    expect(service.get('PORT')).toBe('4000');
    expect(manager).toBeDefined();
    if (manager === undefined) {
      throw new Error('Expected ConfigReloadManager to be registered.');
    }

    try {
      manager.onApplicationBootstrap();
      manager.onApplicationBootstrap();

      expect(watchCallbacks.size).toBe(1);

      writeFileSync(envPath, 'PORT=4100\n');
      await expectWatchReload(manager, emitWatchChange, (snapshot, reason) => reason === 'watch' && snapshot['PORT'] === '4100');

      expect(service.get('PORT')).toBe('4100');
      expect(watchCallbacks.size).toBe(1);
    } finally {
      manager.onModuleDestroy();
    }

    expect(watchCallbacks.size).toBe(0);
  });
});
