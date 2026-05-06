import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getClassDiMetadata, getModuleMetadata } from '@fluojs/core/internal';
import { describe, expect, it, vi } from 'vitest';

import { ConfigModule } from './module.js';
import { ConfigService } from './service.js';
import type { ConfigModuleOptions } from './types.js';

const watchCallbacks = vi.hoisted(() => new Set<() => void>());

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
    const providers = getModuleMetadata(moduleRef)?.providers as Array<ConfigProvider | WatchManagerConstructor> | undefined;
    const configProvider = providers?.find(
      (provider): provider is ConfigProvider => typeof provider === 'object' && provider.provide === ConfigService,
    );
    const optionsProvider = providers?.find(
      (provider): provider is ConfigProvider => typeof provider === 'object' && provider.useValue !== undefined,
    );
    const watchManagerProvider = providers?.find(
      (provider): provider is WatchManagerConstructor => typeof provider === 'function' && provider.name === 'ConfigModuleWatchManager',
    );

    expect(watchManagerProvider ? getClassDiMetadata(watchManagerProvider)?.inject : undefined).toEqual([
      ConfigService,
      optionsProvider?.provide,
    ]);

    const service = configProvider?.useFactory?.() as ConfigService | undefined;
    const manager = service && optionsProvider?.useValue && watchManagerProvider
      ? new watchManagerProvider(service, optionsProvider.useValue as ConfigModuleOptions)
      : undefined;

    expect(service?.get('PORT')).toBe('4000');
    expect(manager).toBeDefined();

    try {
      manager?.onApplicationBootstrap();

      writeFileSync(envPath, 'PORT=4100\n');
      emitWatchChange();
      await waitForCondition(() => service?.get('PORT') === '4100');

      expect(service?.get('PORT')).toBe('4100');
      expect(watchCallbacks.size).toBe(1);
    } finally {
      manager?.onModuleDestroy();
    }

    expect(watchCallbacks.size).toBe(0);
  });
});
