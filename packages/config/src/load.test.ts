import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getModuleMetadata } from '@fluojs/core/internal';
import { describe, expect, it } from 'vitest';

import { createConfigReloader, loadConfig } from './load.js';
import { ConfigModule } from './module.js';
import { ConfigService, replaceConfigServiceSnapshot } from './service.js';

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

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('loadConfig', () => {
  it('merges defaults, env file, process env, and runtime overrides in order', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'PORT=4000\nNAME=from-file\n');

    const loaded = loadConfig({
      cwd,
      defaults: { NAME: 'from-default', PORT: '3000' },
      envFile: envPath,
      processEnv: { NAME: 'from-process' },
      runtimeOverrides: { NAME: 'from-runtime' },
    });

    expect(loaded).toMatchObject({
      NAME: 'from-runtime',
      PORT: '4000',
    });
  });

  it('does not read live process.env unless it is passed explicitly', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-live-process-env-'));
    const previousValue = process.env.FLUO_CONFIG_TEST_ONLY;
    process.env.FLUO_CONFIG_TEST_ONLY = 'from-live-process-env';

    try {
      const implicit = loadConfig({ cwd });
      const explicit = loadConfig({ cwd, processEnv: process.env });

      expect(implicit['FLUO_CONFIG_TEST_ONLY']).toBeUndefined();
      expect(explicit['FLUO_CONFIG_TEST_ONLY']).toBe('from-live-process-env');
    } finally {
      if (previousValue === undefined) {
        delete process.env.FLUO_CONFIG_TEST_ONLY;
      } else {
        process.env.FLUO_CONFIG_TEST_ONLY = previousValue;
      }
    }
  });

  it('supports envFilePath as alias for envFile', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-envpath-'));
    const envPath = join(cwd, '.env.custom');

    writeFileSync(envPath, 'API_KEY=test-key-123\n');

    const loaded = loadConfig({
      cwd,
      envFilePath: envPath,
      processEnv: {},
    });

    expect(loaded['API_KEY']).toBe('test-key-123');
  });

  it('prefers envFilePath over envFile when both provided', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-envpath-pref-'));
    const envFilePrimary = join(cwd, '.env.primary');
    const envFileAlias = join(cwd, '.env.alias');

    writeFileSync(envFilePrimary, 'KEY=from-primary\n');
    writeFileSync(envFileAlias, 'KEY=from-alias\n');

    const loaded = loadConfig({
      cwd,
      envFile: envFilePrimary,
      envFilePath: envFileAlias,
      processEnv: {},
    });

    expect(loaded['KEY']).toBe('from-alias');
  });

  it('does not let undefined process env values overwrite file/default values', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-undefined-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'PORT=4000\n');

    const loaded = loadConfig({
      cwd,
      defaults: { PORT: '3000' },
      envFile: envPath,
      processEnv: { PORT: undefined },
    });

    expect(loaded).toMatchObject({ PORT: '4000' });
  });

  it('deep merges nested objects instead of replacing subtrees', () => {
    const loaded = loadConfig({
      defaults: {
        db: {
          host: 'localhost',
          port: 5432,
          credentials: {
            user: 'app',
            password: 'default-secret',
          },
        },
      },
      processEnv: {},
      runtimeOverrides: {
        db: {
          host: 'db.internal',
          credentials: {
            password: 'runtime-secret',
          },
        },
      },
    });

    expect(loaded).toEqual({
      db: {
        host: 'db.internal',
        port: 5432,
        credentials: {
          user: 'app',
          password: 'runtime-secret',
        },
      },
    });
  });

  it('fails when validation rejects the merged config', () => {
    expect(() =>
      loadConfig({
        validate: () => {
          throw new Error('PORT is required');
        },
      }),
    ).toThrow('Invalid configuration.');
  });

  it('parses multiline values from env files using dotenv', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-multiline-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\\nMIIEowIBAAKCAQ\\n-----END RSA PRIVATE KEY-----"\n');

    const loaded = loadConfig({ cwd, envFile: envPath, processEnv: {} });

    expect(loaded['PRIVATE_KEY']).toContain('BEGIN RSA PRIVATE KEY');
    expect(loaded['PRIVATE_KEY']).toContain('\n');
  });

  it('expands variable interpolation in env files', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-expand-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'DB_HOST=localhost\nDB_PORT=5432\nDATABASE_URL=${DB_HOST}:${DB_PORT}/mydb\n');

    const loaded = loadConfig({ cwd, envFile: envPath, processEnv: {} });

    expect(loaded['DATABASE_URL']).toBe('localhost:5432/mydb');
  });

  it('uses a custom parse function when provided', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-custom-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'KEY: value\n');

    const loaded = loadConfig({
      cwd,
      envFile: envPath,
      processEnv: {},
      parse: (content) => {
        const result: Record<string, string> = {};
        for (const line of content.split('\n')) {
          const colonIdx = line.indexOf(':');
          if (colonIdx !== -1) {
            result[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
          }
        }
        return result;
      },
    });

    expect(loaded['KEY']).toBe('value');
  });

  it('emits reload notifications through explicit subscriptions', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-reload-subscribe-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'PORT=4000\n');

    const reloader = createConfigReloader({
      cwd,
      envFile: envPath,
      processEnv: {},
    });

    try {
      const updates: Array<{ port: string; reason: string }> = [];
      const subscription = reloader.subscribe((snapshot, reason) => {
        const port = snapshot['PORT'];
        if (typeof port === 'string') {
          updates.push({ port, reason });
        }
      });

      writeFileSync(envPath, 'PORT=4100\n');
      const reloaded = reloader.reload();
      expect(reloaded['PORT']).toBe('4100');
      expect(updates).toHaveLength(1);
      expect(updates[0]?.reason).toBe('manual');
      expect(updates[0]?.port).toBe('4100');

      subscription.unsubscribe();
      writeFileSync(envPath, 'PORT=4200\n');
      reloader.reload();
      expect(updates).toHaveLength(1);
    } finally {
      reloader.close();
    }
  });

  it('isolates manual reload snapshots across listeners', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-reload-isolation-manual-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'PORT=4000\n');

    const reloader = createConfigReloader({
      cwd,
      envFile: envPath,
      processEnv: {},
    });

    try {
      let observedBySecondListener: string | undefined;

      reloader.subscribe((snapshot) => {
        snapshot['PORT'] = '9999';
      });

      reloader.subscribe((snapshot) => {
        const port = snapshot['PORT'];
        if (typeof port === 'string') {
          observedBySecondListener = port;
        }
      });

      writeFileSync(envPath, 'PORT=4100\n');
      reloader.reload();

      expect(observedBySecondListener).toBe('4100');
    } finally {
      reloader.close();
    }
  });

  it('updates current() before notifying manual reload listeners', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-reload-current-visibility-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'PORT=4000\n');

    const reloader = createConfigReloader({
      cwd,
      envFile: envPath,
      processEnv: {},
    });

    try {
      const observed: Array<{ callbackPort: string; currentPort: string | undefined }> = [];

      reloader.subscribe((snapshot, reason) => {
        if (reason !== 'manual') {
          return;
        }

        const callbackPort = snapshot['PORT'];
        const currentPort = reloader.current()['PORT'];

        if (typeof callbackPort === 'string') {
          observed.push({ callbackPort, currentPort: typeof currentPort === 'string' ? currentPort : undefined });
        }
      });

      writeFileSync(envPath, 'PORT=4100\n');
      reloader.reload();

      expect(observed).toEqual([{ callbackPort: '4100', currentPort: '4100' }]);
    } finally {
      reloader.close();
    }
  });

  it('keeps last valid snapshot and reports validation failures in watch mode', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-watch-validation-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'PORT=4000\n');

    const reloader = createConfigReloader({
      cwd,
      envFile: envPath,
      processEnv: {},
      validate: (raw) => {
        const port = raw['PORT'];

        if (typeof port !== 'string' || !/^\d+$/.test(port)) {
          throw new Error('PORT must be numeric');
        }

        return raw;
      },
      watch: true,
    });

    try {
      const updates: string[] = [];
      const errors: string[] = [];
      const updateSubscription = reloader.subscribe((snapshot, reason) => {
        if (reason !== 'watch') {
          return;
        }

        const port = snapshot['PORT'];
        if (typeof port === 'string') {
          updates.push(port);
        }
      });
      const errorSubscription = reloader.subscribeError((error, reason) => {
        if (reason !== 'watch') {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        errors.push(message);
      });

      await delay(100);
      writeFileSync(envPath, 'PORT=oops\n');
      await waitForCondition(() => errors.length > 0);
      expect(reloader.current()['PORT']).toBe('4000');

      await delay(100);
      writeFileSync(envPath, 'PORT=4300\n');
      await waitForCondition(() => updates.includes('4300'));
      expect(reloader.current()['PORT']).toBe('4300');

      updateSubscription.unsubscribe();
      errorSubscription.unsubscribe();
    } finally {
      reloader.close();
    }
  });

  it('keeps the previous snapshot when manual reload listeners throw', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-reload-ordering-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'PORT=4000\n');

    const reloader = createConfigReloader({
      cwd,
      envFile: envPath,
      processEnv: {},
    });

    try {
      reloader.subscribe((_snapshot, reason) => {
        if (reason === 'manual') {
          throw new Error('listener failed');
        }
      });

      writeFileSync(envPath, 'PORT=4700\n');

      expect(() => reloader.reload()).toThrow('listener failed');
      expect(reloader.current()['PORT']).toBe('4000');
    } finally {
      reloader.close();
    }
  });

  it('stops watch notifications after close', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-watch-close-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'PORT=4000\n');

    const reloader = createConfigReloader({
      cwd,
      envFile: envPath,
      processEnv: {},
      watch: true,
    });

    const updates: string[] = [];
    reloader.subscribe((snapshot, reason) => {
      if (reason !== 'watch') {
        return;
      }

      const port = snapshot['PORT'];
      if (typeof port === 'string') {
        updates.push(port);
      }
    });

    reloader.close();

    writeFileSync(envPath, 'PORT=4400\n');
    await delay(150);

    expect(updates).toHaveLength(0);
  });

  it('isolates watch reload snapshots across listeners', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-reload-isolation-watch-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'PORT=4000\n');

    const reloader = createConfigReloader({
      cwd,
      envFile: envPath,
      processEnv: {},
      watch: true,
    });

    try {
      let observedBySecondListener: string | undefined;

      reloader.subscribe((snapshot, reason) => {
        if (reason !== 'watch') {
          return;
        }

        snapshot['PORT'] = '9999';
      });

      reloader.subscribe((snapshot, reason) => {
        if (reason !== 'watch') {
          return;
        }

        const port = snapshot['PORT'];
        if (typeof port === 'string') {
          observedBySecondListener = port;
        }
      });

      await delay(100);
      writeFileSync(envPath, 'PORT=4500\n');
      await waitForCondition(() => observedBySecondListener !== undefined);

      expect(observedBySecondListener).toBe('4500');
    } finally {
      reloader.close();
    }
  });
});

describe('ConfigService', () => {
  it('reads keys with get returning undefined for missing', () => {
    const service = new ConfigService({ PORT: '3000' });

    expect(service.get('PORT')).toBe('3000');
    expect(service.get('MISSING' as never)).toBeUndefined();
  });

  it('resolves nested dot-path keys', () => {
    const service = new ConfigService({ db: { host: 'localhost', port: 5432 } });

    expect(service.get('db.host')).toBe('localhost');
    expect(service.get('db.port')).toBe(5432);
  });

  it('throws on missing required key with getOrThrow', () => {
    const service = new ConfigService({ PORT: '3000' });

    expect(() => service.getOrThrow('MISSING' as never)).toThrow('Missing config key');
  });

  it('returns value with getOrThrow for existing key', () => {
    const service = new ConfigService({ PORT: '3000' });

    expect(service.getOrThrow('PORT')).toBe('3000');
  });

  it('returns undefined for missing nested key with get', () => {
    const service = new ConfigService({ db: { host: 'localhost' } });

    expect(service.get('db.missing' as never)).toBeUndefined();
  });

  it('does not resolve inherited top-level keys', () => {
    const values = Object.create({ PORT: '3000' }) as Record<string, unknown>;
    const service = new ConfigService(values);

    expect(service.get('PORT' as never)).toBeUndefined();
    expect(() => service.getOrThrow('PORT' as never)).toThrow('Missing config key');
  });

  it('does not resolve inherited nested keys', () => {
    const db = Object.create({ host: 'localhost' }) as Record<string, unknown>;
    const service = new ConfigService({ db });

    expect(service.get('db.host' as never)).toBeUndefined();
    expect(() => service.getOrThrow('db.host' as never)).toThrow('Missing config key');
  });

  it('provides typed get for generic ConfigService', () => {
    type AppConfig = { PORT: string; DB_URL: string };
    const service = new ConfigService<AppConfig>({ PORT: '3000', DB_URL: 'postgres://localhost' });

    const port = service.get('PORT');
    const dbUrl = service.get('DB_URL');

    expect(port).toBe('3000');
    expect(dbUrl).toBe('postgres://localhost');
  });

  it('returns deep-cloned snapshots', () => {
    const service = new ConfigService({
      db: { host: 'localhost' },
      features: { flags: ['alpha'] },
    });

    const snapshot = service.snapshot() as {
      db: { host: string };
      features: { flags: string[] };
    };

    snapshot.db.host = 'remote';
    snapshot.features.flags.push('beta');

    const latest = service.snapshot() as {
      db: { host: string };
      features: { flags: string[] };
    };

    expect(latest.db.host).toBe('localhost');
    expect(latest.features.flags).toEqual(['alpha']);
  });

  it('isolates internal state from caller mutations', () => {
    const source = {
      db: { host: 'localhost' },
    };

    const service = new ConfigService(source);
    source.db.host = 'mutated';

    expect(service.get('db.host')).toBe('localhost');
  });

  it('replaces the active snapshot without changing service identity', () => {
    const service = new ConfigService({ PORT: '3000', nested: { host: 'localhost' } });

    replaceConfigServiceSnapshot(service, { PORT: '3100', nested: { host: 'remote' } });

    expect(service.get('PORT')).toBe('3100');
    expect(service.get('nested.host')).toBe('remote');
  });
});

describe('ConfigModule', () => {
  it('uses the provided processEnv snapshot through ConfigService registration', () => {
    const previousValue = process.env.FLUO_CONFIG_MODULE_TEST_ONLY;
    process.env.FLUO_CONFIG_MODULE_TEST_ONLY = 'from-module-process-env';

    try {
      const moduleRef = ConfigModule.forRoot({ processEnv: process.env });
      const providers = getModuleMetadata(moduleRef)?.providers as
        | Array<{ provide?: unknown; useFactory?: () => unknown }>
        | undefined;
      const configProvider = providers?.find((provider) => provider.provide === ConfigService);
      const service = configProvider?.useFactory?.() as ConfigService | undefined;

      expect(service?.get('FLUO_CONFIG_MODULE_TEST_ONLY')).toBe('from-module-process-env');
    } finally {
      if (previousValue === undefined) {
        delete process.env.FLUO_CONFIG_MODULE_TEST_ONLY;
      } else {
        process.env.FLUO_CONFIG_MODULE_TEST_ONLY = previousValue;
      }
    }
  });

  it('does not read live process.env when ConfigModule callers omit processEnv', () => {
    const previousValue = process.env.FLUO_CONFIG_MODULE_TEST_ONLY;
    process.env.FLUO_CONFIG_MODULE_TEST_ONLY = 'from-module-process-env';

    try {
      const moduleRef = ConfigModule.forRoot();
      const providers = getModuleMetadata(moduleRef)?.providers as
        | Array<{ provide?: unknown; useFactory?: () => unknown }>
        | undefined;
      const configProvider = providers?.find((provider) => provider.provide === ConfigService);
      const service = configProvider?.useFactory?.() as ConfigService | undefined;

      expect(service?.get('FLUO_CONFIG_MODULE_TEST_ONLY')).toBeUndefined();
    } finally {
      if (previousValue === undefined) {
        delete process.env.FLUO_CONFIG_MODULE_TEST_ONLY;
      } else {
        process.env.FLUO_CONFIG_MODULE_TEST_ONLY = previousValue;
      }
    }
  });

  it('registers as global by default', () => {
    const moduleRef = ConfigModule.forRoot();

    expect(getModuleMetadata(moduleRef)?.global).toBe(true);
  });

  it('honors isGlobal=false', () => {
    const moduleRef = ConfigModule.forRoot({ isGlobal: false });

    expect(getModuleMetadata(moduleRef)?.global).toBe(false);
  });

  it('honors isGlobal=true', () => {
    const moduleRef = ConfigModule.forRoot({ isGlobal: true });

    expect(getModuleMetadata(moduleRef)?.global).toBe(true);
  });
});
