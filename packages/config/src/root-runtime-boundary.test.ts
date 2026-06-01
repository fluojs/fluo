import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

type ProcessWithGetBuiltinModule = typeof process & {
  getBuiltinModule?: typeof process.getBuiltinModule;
};

type ErrorWithCause = Error & {
  cause?: unknown;
};

const processWithGetBuiltinModule = process as ProcessWithGetBuiltinModule;
const originalGetBuiltinModuleDescriptor = Object.getOwnPropertyDescriptor(processWithGetBuiltinModule, 'getBuiltinModule');

function spyOnGetBuiltinModule(implementation: typeof process.getBuiltinModule) {
  if (!processWithGetBuiltinModule.getBuiltinModule) {
    Object.defineProperty(processWithGetBuiltinModule, 'getBuiltinModule', {
      configurable: true,
      value: implementation,
      writable: true,
    });
  }

  return vi.spyOn(processWithGetBuiltinModule as typeof process & { getBuiltinModule: typeof process.getBuiltinModule }, 'getBuiltinModule').mockImplementation(implementation);
}

function getErrorCause(error: unknown): unknown {
  if (error instanceof Error && 'cause' in error) {
    return (error as ErrorWithCause).cause;
  }

  return undefined;
}

describe('@fluojs/config root runtime boundary', () => {
  afterEach(() => {
    vi.doUnmock('node:crypto');
    vi.doUnmock('node:fs');
    vi.doUnmock('node:module');
    vi.doUnmock('node:path');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();

    if (originalGetBuiltinModuleDescriptor) {
      Object.defineProperty(processWithGetBuiltinModule, 'getBuiltinModule', originalGetBuiltinModuleDescriptor);
    } else {
      Reflect.deleteProperty(processWithGetBuiltinModule, 'getBuiltinModule');
    }
  });

  it('does not statically resolve Node builtins from the root public API path', async () => {
    for (const id of ['node:crypto', 'node:fs', 'node:module', 'node:path']) {
      vi.doMock(id, () => {
        throw new Error(`Root import statically resolved ${id}.`);
      });
    }

    const configPublicApi = await import('./index.js');

    expect(configPublicApi).toHaveProperty('ConfigService');
    expect(configPublicApi).toHaveProperty('loadConfig');
  });

  it('does not resolve Node builtins when importing the root public API', async () => {
    const getBuiltinModule = spyOnGetBuiltinModule(((id: string) => {
      throw new Error(`Root import attempted to resolve ${id}.`);
    }) as typeof process.getBuiltinModule);

    const configPublicApi = await import('./index.js');

    expect(configPublicApi).toHaveProperty('ConfigService');
    expect(configPublicApi).toHaveProperty('loadConfig');
    expect(getBuiltinModule).not.toHaveBeenCalled();
  });

  it('loads in-memory config without resolving cwd, env files, or Node builtins', async () => {
    const getBuiltinModule = spyOnGetBuiltinModule(((id: string) => {
      throw new Error(`In-memory loading attempted to resolve ${id}.`);
    }) as typeof process.getBuiltinModule);
    const cwd = vi.spyOn(process, 'cwd').mockImplementation(() => {
      throw new Error('In-memory loading attempted to resolve process.cwd().');
    });

    const { loadConfig } = await import('./index.js');

    expect(loadConfig({ defaults: { PORT: '3000' }, processEnv: {}, runtimeOverrides: { FEATURE: 'enabled' } })).toEqual({
      FEATURE: 'enabled',
      PORT: '3000',
    });
    expect(getBuiltinModule).not.toHaveBeenCalled();
    expect(cwd).not.toHaveBeenCalled();
  });

  it('loads env files through the Node 20.16 getBuiltinModule fallback when direct filesystem builtin lookup is unavailable', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-node20-16-fallback-'));
    const envFilePath = join(cwd, '.env');
    const getBuiltinModule = processWithGetBuiltinModule.getBuiltinModule;

    writeFileSync(envFilePath, 'PORT=4010\n');
    vi.stubGlobal('require', () => {
      throw new Error('Node 20.16 ESM fallback must not depend on global require.');
    });
    spyOnGetBuiltinModule(((id: string) => (id === 'node:module' ? getBuiltinModule?.('node:module') : undefined)) as typeof process.getBuiltinModule);

    const { loadConfig } = await import('./index.js');

    expect(loadConfig({ envFilePath, processEnv: {} })).toMatchObject({ PORT: '4010' });
  });

  it('fails env-file loading when process.getBuiltinModule is unavailable', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-no-get-builtin-module-'));
    const envFilePath = join(cwd, '.env');

    writeFileSync(envFilePath, 'PORT=4010\n');
    Object.defineProperty(processWithGetBuiltinModule, 'getBuiltinModule', {
      configurable: true,
      value: undefined,
      writable: true,
    });

    const { loadConfig } = await import('./index.js');

    try {
      loadConfig({ envFilePath, processEnv: {} });
    } catch (error: unknown) {
      expect(error).toMatchObject({
        code: 'CONFIG_RUNTIME_UNAVAILABLE',
        message: 'Node.js configuration loading is unavailable in this runtime.',
      });
      expect(getErrorCause(error)).toEqual(expect.objectContaining({
        message: expect.stringContaining('Node.js 20.16.0 or newer is required'),
      }));
      return;
    }

    throw new Error('Expected env-file loading to fail without process.getBuiltinModule.');
  });
});
