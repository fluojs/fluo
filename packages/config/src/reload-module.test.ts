import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getModuleMetadata } from '@fluojs/core/internal';
import { describe, expect, it } from 'vitest';

import { CONFIG_RELOADER, ConfigReloadManager, ConfigReloadModule } from './reload-module.js';
import { ConfigService } from './service.js';
import type { ConfigDictionary, ConfigLoadOptions } from './types.js';

describe('ConfigReloadManager', () => {
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
});
