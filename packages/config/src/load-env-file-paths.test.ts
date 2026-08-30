import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { getModuleMetadata } from '@fluojs/core/internal';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createConfigReloader, loadConfig } from './load.js';
import { ConfigModule } from './module.js';
import { ConfigService } from './service.js';
import type { ConfigDictionary, ConfigSchema } from './types.js';

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
        resolve,
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

function isConfigDictionary(value: unknown): value is ConfigDictionary {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createPortSchema(): ConfigSchema {
  return {
    '~standard': {
      validate: (value: unknown) => {
        if (!isConfigDictionary(value)) {
          return { issues: [{ message: 'config must be an object' }] };
        }

        const port = value.PORT;

        if (typeof port !== 'string' || !/^\d+$/.test(port)) {
          return { issues: [{ message: 'PORT must be numeric', path: ['PORT'] }] };
        }

        return { value: { ...value, PORT: Number(port) } };
      },
      vendor: 'test',
      version: 1,
    },
  };
}

beforeEach(() => {
  watchCallbacks.clear();
  installNodeBuiltinMock();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('loadConfig envFilePaths ordered multi-file loading', () => {
  it('merges listed env files from lowest to highest precedence', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-ordered-'));
    const base = join(cwd, '.env');
    const environment = join(cwd, '.env.production');
    const local = join(cwd, '.env.production.local');

    writeFileSync(base, 'PORT=3000\nNAME=from-base\nREGION=base-region\n');
    writeFileSync(environment, 'PORT=4000\nNAME=from-environment\n');
    writeFileSync(local, 'NAME=from-local\n');

    const loaded = loadConfig({
      cwd,
      envFilePaths: [base, environment, local],
      processEnv: {},
    });

    expect(loaded).toMatchObject({
      NAME: 'from-local',
      PORT: '4000',
      REGION: 'base-region',
    });
  });

  it('keeps env files below processEnv and runtimeOverrides', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-ordered-precedence-'));
    const base = join(cwd, '.env');
    const overlay = join(cwd, '.env.overlay');

    writeFileSync(base, 'PORT=3000\nNAME=from-base\nHOST=from-base\n');
    writeFileSync(overlay, 'PORT=4000\nNAME=from-overlay\n');

    const loaded = loadConfig({
      cwd,
      defaults: { LEVEL: 'from-defaults', PORT: '1000' },
      envFilePaths: [base, overlay],
      processEnv: { HOST: 'from-process' },
      runtimeOverrides: { NAME: 'from-runtime' },
    });

    expect(loaded).toMatchObject({
      HOST: 'from-process',
      LEVEL: 'from-defaults',
      NAME: 'from-runtime',
      PORT: '4000',
    });
  });

  it('skips missing files in the list without failing the load', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-ordered-missing-'));
    const base = join(cwd, '.env');
    const absent = join(cwd, '.env.absent');
    const local = join(cwd, '.env.local');

    writeFileSync(base, 'PORT=3000\nNAME=from-base\n');
    writeFileSync(local, 'NAME=from-local\n');

    const loaded = loadConfig({
      cwd,
      envFilePaths: [base, absent, local],
      processEnv: {},
    });

    expect(loaded).toMatchObject({
      NAME: 'from-local',
      PORT: '3000',
    });
  });

  it('treats an empty list as an explicit opt out of env-file loading', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-ordered-empty-'));

    writeFileSync(join(cwd, '.env'), 'PORT=9999\n');

    const loaded = loadConfig({
      cwd,
      defaults: { PORT: '3000' },
      envFilePaths: [],
      processEnv: {},
    });

    expect(loaded).toEqual({ PORT: '3000' });
  });

  it('rejects mixing envFilePaths with envFile', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-ordered-conflict-file-'));
    const base = join(cwd, '.env');

    writeFileSync(base, 'PORT=3000\n');

    expect(() =>
      loadConfig({
        cwd,
        envFile: base,
        envFilePaths: [base],
        processEnv: {},
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });

  it('rejects mixing envFilePaths with envFilePath', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-ordered-conflict-path-'));
    const base = join(cwd, '.env');

    writeFileSync(base, 'PORT=3000\n');

    expect(() =>
      loadConfig({
        cwd,
        envFilePath: base,
        envFilePaths: [base],
        processEnv: {},
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });

  it('rejects duplicate entries inside envFilePaths', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-ordered-duplicate-'));
    const base = join(cwd, '.env');

    writeFileSync(base, 'PORT=3000\n');

    expect(() =>
      loadConfig({
        cwd,
        envFilePaths: [base, base],
        processEnv: {},
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });

  it('rejects non-string and empty entries inside envFilePaths', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-ordered-invalid-entry-'));

    expect(() =>
      loadConfig({
        cwd,
        envFilePaths: ['   '],
        processEnv: {},
      }),
    ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }));
  });

  it('resolves relative entries against cwd', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-ordered-relative-'));

    writeFileSync(join(cwd, '.env'), 'PORT=3000\nNAME=from-base\n');
    writeFileSync(join(cwd, '.env.local'), 'NAME=from-local\n');

    const loaded = loadConfig({
      cwd,
      envFilePaths: ['.env', '.env.local'],
      processEnv: {},
    });

    expect(loaded).toMatchObject({
      NAME: 'from-local',
      PORT: '3000',
    });
  });

  it('validates the fully merged list exactly once', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-ordered-validate-'));
    const base = join(cwd, '.env');
    const overlay = join(cwd, '.env.overlay');

    writeFileSync(base, 'PORT=not-a-number\n');
    writeFileSync(overlay, 'PORT=4100\n');

    const loaded = loadConfig({
      cwd,
      envFilePaths: [base, overlay],
      processEnv: {},
      schema: createPortSchema(),
    });

    expect(loaded).toEqual({ PORT: 4100 });
  });
});

describe('loadConfig single-file backward compatibility', () => {
  it('keeps envFile behavior unchanged when envFilePaths is absent', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-single-compat-'));
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

  it('keeps the default <cwd>/.env behavior when envFilePaths is undefined', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-single-default-'));

    writeFileSync(join(cwd, '.env'), 'PORT=4200\n');

    expect(loadConfig({ cwd })['PORT']).toBe('4200');
  });
});

describe('createConfigReloader envFilePaths', () => {
  it('recomputes the whole list when one watched file changes', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-ordered-watch-'));
    const base = join(cwd, '.env');
    const overlay = join(cwd, '.env.overlay');

    writeFileSync(base, 'PORT=4000\nNAME=from-base\n');
    writeFileSync(overlay, 'NAME=from-overlay\n');

    const reloader = createConfigReloader({
      cwd,
      envFilePaths: [base, overlay],
      processEnv: {},
      watch: true,
    });

    try {
      expect(reloader.current()).toMatchObject({ NAME: 'from-overlay', PORT: '4000' });

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

      writeFileSync(base, 'PORT=4100\nNAME=from-base\n');
      emitWatchChange();

      await waitForCondition(() => updates.includes('4100'));
      expect(reloader.current()).toMatchObject({ NAME: 'from-overlay', PORT: '4100' });
    } finally {
      reloader.close();
    }
  });

  it('falls back to remaining files when a higher-precedence file is deleted', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-ordered-watch-delete-'));
    const base = join(cwd, '.env');
    const overlay = join(cwd, '.env.overlay');

    writeFileSync(base, 'NAME=from-base\n');
    writeFileSync(overlay, 'NAME=from-overlay\n');

    const reloader = createConfigReloader({
      cwd,
      envFilePaths: [base, overlay],
      processEnv: {},
      watch: true,
    });

    try {
      expect(reloader.current()['NAME']).toBe('from-overlay');

      const updates: string[] = [];
      reloader.subscribe((snapshot, reason) => {
        if (reason !== 'watch') {
          return;
        }

        const name = snapshot['NAME'];
        if (typeof name === 'string') {
          updates.push(name);
        }
      });

      rmSync(overlay);
      emitWatchChange();

      await waitForCondition(() => updates.includes('from-base'));
      expect(reloader.current()['NAME']).toBe('from-base');
    } finally {
      reloader.close();
    }
  });

  it('reloads after an atomic replacement of a listed file', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-ordered-watch-atomic-'));
    const base = join(cwd, '.env');
    const overlay = join(cwd, '.env.overlay');
    const replacement = join(cwd, '.env.overlay.next');

    writeFileSync(base, 'PORT=4000\n');
    writeFileSync(overlay, 'PORT=4100\n');

    const reloader = createConfigReloader({
      cwd,
      envFilePaths: [base, overlay],
      processEnv: {},
      watch: true,
    });

    try {
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

      writeFileSync(replacement, 'PORT=4200\n');
      renameSync(replacement, overlay);
      emitWatchChange();

      await waitForCondition(() => updates.includes('4200'));
      expect(reloader.current()['PORT']).toBe('4200');
    } finally {
      reloader.close();
    }
  });

  it('keeps the last valid snapshot when a watched list reload fails validation', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-ordered-watch-invalid-'));
    const base = join(cwd, '.env');
    const overlay = join(cwd, '.env.overlay');

    writeFileSync(base, 'PORT=4000\n');
    writeFileSync(overlay, 'PORT=4100\n');

    const reloader = createConfigReloader({
      cwd,
      envFilePaths: [base, overlay],
      processEnv: {},
      schema: createPortSchema(),
      watch: true,
    });

    try {
      expect(reloader.current()['PORT']).toBe(4100);

      const failures: unknown[] = [];
      reloader.subscribeError((error) => {
        failures.push(error);
      });

      writeFileSync(overlay, 'PORT=not-a-number\n');
      emitWatchChange();

      await waitForCondition(() => failures.length > 0);
      expect(failures[0]).toMatchObject({ code: 'INVALID_CONFIG' });
      expect(reloader.current()['PORT']).toBe(4100);
    } finally {
      reloader.close();
    }
  });

  it('watches each distinct parent directory exactly once', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-ordered-watch-dirs-'));
    const base = join(cwd, '.env');
    const overlay = join(cwd, '.env.overlay');

    writeFileSync(base, 'PORT=4000\n');
    writeFileSync(overlay, 'PORT=4100\n');

    const reloader = createConfigReloader({
      cwd,
      envFilePaths: [base, overlay],
      processEnv: {},
      watch: true,
    });

    try {
      expect(watchCallbacks.size).toBe(1);
      expect(vi.mocked(watch).mock.calls.at(-1)?.[0]).toBe(cwd);
    } finally {
      reloader.close();
    }
  });

  it('closes every watcher started for the list', () => {
    const parentA = mkdtempSync(join(tmpdir(), 'fluo-config-ordered-close-a-'));
    const parentB = mkdtempSync(join(tmpdir(), 'fluo-config-ordered-close-b-'));
    const base = join(parentA, '.env');
    const overlay = join(parentB, '.env.overlay');

    writeFileSync(base, 'PORT=4000\n');
    writeFileSync(overlay, 'PORT=4100\n');

    const reloader = createConfigReloader({
      envFilePaths: [base, overlay],
      processEnv: {},
      watch: true,
    });

    expect(watchCallbacks.size).toBe(2);

    reloader.close();

    expect(watchCallbacks.size).toBe(0);
  });
});

describe('ConfigModule envFilePaths', () => {
  it('registers a snapshot merged from the ordered list', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-ordered-module-'));
    const base = join(cwd, '.env');
    const overlay = join(cwd, '.env.overlay');

    writeFileSync(base, 'PORT=3000\nNAME=from-base\n');
    writeFileSync(overlay, 'NAME=from-overlay\n');

    const moduleRef = ConfigModule.forRoot({
      envFilePaths: [base, overlay],
      processEnv: {},
    });
    const providers = getModuleMetadata(moduleRef)?.providers as
      | Array<{ provide?: unknown; useFactory?: () => unknown }>
      | undefined;
    const service = providers
      ?.find((provider) => provider.provide === ConfigService)
      ?.useFactory?.() as ConfigService | undefined;

    expect(service?.get('NAME')).toBe('from-overlay');
    expect(service?.get('PORT')).toBe('3000');
  });

  it('does not observe caller mutations of the env file list after registration', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-ordered-snapshot-'));
    const base = join(cwd, '.env');
    const overlay = join(cwd, '.env.overlay');

    writeFileSync(base, 'NAME=from-base\n');
    writeFileSync(overlay, 'NAME=from-overlay\n');

    const envFilePaths = [base];
    const reloader = createConfigReloader({
      cwd,
      envFilePaths,
      processEnv: {},
    });

    try {
      envFilePaths.push(overlay);

      expect(reloader.reload()['NAME']).toBe('from-base');
    } finally {
      reloader.close();
    }
  });
});
