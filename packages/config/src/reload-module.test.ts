import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { getModuleMetadata } from '@fluojs/core/internal';
import { Container, type Provider } from '@fluojs/di';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigModule } from './module.js';
import { CONFIG_RELOADER, ConfigReloadManager, ConfigReloadModule } from './reload-module.js';
import { ConfigService } from './service.js';
import type { ConfigDictionary, ConfigLoadOptions, ConfigReloader } from './types.js';

const watchCallbacks = vi.hoisted(() => new Set<() => void>());

type ProcessWithGetBuiltinModule = typeof process & {
  getBuiltinModule?: typeof process.getBuiltinModule;
};

const processWithGetBuiltinModule = process as ProcessWithGetBuiltinModule;
const originalGetBuiltinModule = processWithGetBuiltinModule.getBuiltinModule?.bind(process);

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

function emitWatchChange(): void {
  for (const callback of [...watchCallbacks]) {
    callback();
  }
}

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

beforeEach(() => {
  watchCallbacks.clear();
  installNodeBuiltinMock();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function extractProviders(moduleRef: new () => unknown): Provider[] {
  return (getModuleMetadata(moduleRef)?.providers ?? []) as Provider[];
}

describe('ConfigReloadManager', () => {
  it('resolves CONFIG_RELOADER in a production-shaped module graph with ConfigModule', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-reload-module-graph-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'PORT=4000\n');

    const container = new Container();
    container.register(
      ...extractProviders(ConfigModule.forRoot({ envFile: envPath, processEnv: {} })),
      ...extractProviders(ConfigReloadModule.forRoot({ envFile: envPath, processEnv: {} })),
    );

    const reloader = await container.resolve<ConfigReloader>(CONFIG_RELOADER);
    const service = await container.resolve(ConfigService);

    expect(reloader.current()['PORT']).toBe('4000');

    writeFileSync(envPath, 'PORT=4100\n');
    expect(reloader.reload()['PORT']).toBe('4100');
    expect(service.get('PORT')).toBe('4100');
  });

  it('snapshots caller-owned options during ConfigReloadModule registration', () => {
    const options: ConfigLoadOptions = {
      defaults: { nested: { value: 'registered' }, PORT: '4000' },
      processEnv: { PORT: '4100' },
      runtimeOverrides: { FEATURE: 'enabled' },
    };
    const moduleRef = ConfigReloadModule.forRoot(options);

    options.defaults = { nested: { value: 'mutated' }, PORT: '5000' };
    options.processEnv = { PORT: '5100' };
    options.runtimeOverrides = { FEATURE: 'disabled' };

    const providers = getModuleMetadata(moduleRef)?.providers as
      | Array<{ provide?: unknown; useValue?: ConfigLoadOptions; useExisting?: unknown }>
      | undefined;
    const optionsProvider = providers?.find((provider) => provider.useValue !== undefined);
    const reloaderProvider = providers?.find((provider) => provider.provide === CONFIG_RELOADER);
    const snapshot = optionsProvider?.useValue;

    expect(snapshot?.defaults?.['PORT']).toBe('4000');
    expect((snapshot?.defaults?.['nested'] as { value?: unknown } | undefined)?.value).toBe('registered');
    expect(snapshot?.processEnv?.PORT).toBe('4100');
    expect(snapshot?.runtimeOverrides?.['FEATURE']).toBe('enabled');
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(reloaderProvider?.useExisting).toBe(ConfigReloadManager);
  });

  it('reloads the shared ConfigService snapshot without replacing the service identity', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-manager-reload-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'PORT=4000\n');

    const service = new ConfigService<ConfigDictionary>({ PORT: '4000' });
    const manager = new ConfigReloadManager(service, {
      cwd,
      envFile: envPath,
      processEnv: {},
    });

    try {
      const updates: string[] = [];
      const subscription = manager.subscribe((snapshot, reason) => {
        if (reason !== 'manual') {
          return;
        }

        const port = snapshot['PORT'];
        if (typeof port === 'string') {
          updates.push(port);
        }
      });

      writeFileSync(envPath, 'PORT=4100\n');
      const reloaded = manager.reload();

      expect(reloaded['PORT']).toBe('4100');
      expect(service.get('PORT')).toBe('4100');
      expect(updates).toEqual(['4100']);

      subscription.unsubscribe();
    } finally {
      manager.close();
    }
  });

  it('restores the previous ConfigService snapshot when reload listeners throw', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-manager-rollback-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'PORT=4000\n');

    const service = new ConfigService<ConfigDictionary>({ PORT: '4000' });
    const manager = new ConfigReloadManager(service, {
      cwd,
      envFile: envPath,
      processEnv: {},
    });

    try {
      manager.subscribe((_snapshot, reason) => {
        if (reason === 'manual') {
          throw new Error('manager listener failed');
        }
      });

      writeFileSync(envPath, 'PORT=4200\n');

      expect(() => manager.reload()).toThrow('manager listener failed');
      expect(service.get('PORT')).toBe('4000');
      expect(manager.current()['PORT']).toBe('4000');
    } finally {
      manager.close();
    }
  });

  it('serializes nested manager reloads without corrupting the shared service snapshot', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-manager-serialized-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'PORT=4000\n');

    const service = new ConfigService<ConfigDictionary>({ PORT: '4000' });
    const manager = new ConfigReloadManager(service, {
      cwd,
      envFile: envPath,
      processEnv: {},
    });

    try {
      const updates: string[] = [];
      let requestedNestedReload = false;

      manager.subscribe((snapshot, reason) => {
        if (reason !== 'manual') {
          return;
        }

        const port = snapshot['PORT'];
        if (typeof port === 'string') {
          updates.push(port);
        }

        if (!requestedNestedReload) {
          requestedNestedReload = true;
          writeFileSync(envPath, 'PORT=4300\n');
          manager.reload();
        }
      });

      writeFileSync(envPath, 'PORT=4200\n');
      const reloaded = manager.reload();

      expect(reloaded['PORT']).toBe('4300');
      expect(service.get('PORT')).toBe('4300');
      expect(manager.current()['PORT']).toBe('4300');
      expect(updates).toEqual(['4200', '4300']);
    } finally {
      manager.close();
    }
  });

  it('starts watch reloads on application bootstrap and closes watchers during module shutdown', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-reload-module-watch-lifecycle-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'PORT=4000\n');

    const service = new ConfigService<ConfigDictionary>({ PORT: '4000' });
    const manager = new ConfigReloadManager(service, {
      cwd,
      envFile: envPath,
      processEnv: {},
      watch: true,
    });

    try {
      const updates: string[] = [];
      manager.subscribe((snapshot, reason) => {
        if (reason !== 'watch') {
          return;
        }

        const port = snapshot['PORT'];
        if (typeof port === 'string') {
          updates.push(port);
        }
      });

      manager.onApplicationBootstrap();
      expect(watchCallbacks.size).toBe(1);

      writeFileSync(envPath, 'PORT=4100\n');
      emitWatchChange();
      await waitForCondition(() => updates.includes('4100'));

      expect(service.get('PORT')).toBe('4100');

      manager.onModuleDestroy();
      expect(watchCallbacks.size).toBe(0);

      writeFileSync(envPath, 'PORT=4200\n');
      emitWatchChange();

      expect(updates).toEqual(['4100']);
      expect(service.get('PORT')).toBe('4100');
    } finally {
      manager.close();
    }
  });
});
