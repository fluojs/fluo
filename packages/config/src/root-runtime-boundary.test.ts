import { mkdtempSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

type ProcessWithGetBuiltinModule = typeof process & {
  getBuiltinModule?: typeof process.getBuiltinModule;
};

const processWithGetBuiltinModule = process as ProcessWithGetBuiltinModule;

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

describe('@fluojs/config root runtime boundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
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

  it('loads env files through a Node 20.0 compatible fallback when getBuiltinModule is unavailable', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'fluo-config-node20-fallback-'));
    const envFilePath = join(cwd, '.env');

    writeFileSync(envFilePath, 'PORT=4010\n');
    vi.stubGlobal('require', createRequire(import.meta.url));
    spyOnGetBuiltinModule((() => undefined) as typeof process.getBuiltinModule);

    const { loadConfig } = await import('./index.js');

    expect(loadConfig({ envFilePath, processEnv: {} })).toMatchObject({ PORT: '4010' });
  });
});
