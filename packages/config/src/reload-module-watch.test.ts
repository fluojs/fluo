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
import type { ConfigReloader } from './types.js';

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

function emitWatchChange(): void {
  for (const callback of [...watchCallbacks]) {
    callback();
  }
}

function extractProviders(moduleRef: new () => unknown): Provider[] {
  return (getModuleMetadata(moduleRef)?.providers ?? []) as Provider[];
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

describe('ConfigReloadModule watch mode', () => {
  it('creates one watcher during module bootstrap and closes it during module shutdown', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-reload-module-watch-provider-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'PORT=4000\n');

    const container = new Container();
    container.register(
      ...extractProviders(ConfigModule.forRoot({ envFile: envPath, processEnv: {} })),
      ...extractProviders(ConfigReloadModule.forRoot({ envFile: envPath, processEnv: {}, watch: true })),
    );

    const manager = await container.resolve(ConfigReloadManager);
    const reloader = await container.resolve<ConfigReloader>(CONFIG_RELOADER);
    const service = await container.resolve(ConfigService);

    expect(reloader).toBe(manager);
    expect(service.get('PORT')).toBe('4000');
    expect(watchCallbacks.size).toBe(0);

    try {
      manager.onApplicationBootstrap();
      manager.onApplicationBootstrap();

      expect(watchCallbacks.size).toBe(1);

      writeFileSync(envPath, 'PORT=4100\n');
      emitWatchChange();
      await waitForCondition(() => service.get('PORT') === '4100');

      expect(reloader.current().PORT).toBe('4100');
      expect(service.get('PORT')).toBe('4100');
      expect(watchCallbacks.size).toBe(1);
    } finally {
      manager.onModuleDestroy();
    }

    expect(watchCallbacks.size).toBe(0);

    writeFileSync(envPath, 'PORT=4200\n');
    emitWatchChange();

    expect(service.get('PORT')).toBe('4100');
  });
});
