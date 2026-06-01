import { afterEach, describe, expect, it, vi } from 'vitest';

describe('@fluojs/config root runtime boundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('does not resolve Node builtins when importing the root public API', async () => {
    const getBuiltinModule = vi.spyOn(process, 'getBuiltinModule').mockImplementation(((id: string) => {
      throw new Error(`Root import attempted to resolve ${id}.`);
    }) as typeof process.getBuiltinModule);

    const configPublicApi = await import('./index.js');

    expect(configPublicApi).toHaveProperty('ConfigService');
    expect(configPublicApi).toHaveProperty('loadConfig');
    expect(getBuiltinModule).not.toHaveBeenCalled();
  });

  it('loads in-memory config without resolving cwd, env files, or Node builtins', async () => {
    const getBuiltinModule = vi.spyOn(process, 'getBuiltinModule').mockImplementation(((id: string) => {
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

  it('guards env-file loading when the host cannot provide lazy Node builtins', async () => {
    vi.spyOn(process, 'getBuiltinModule').mockImplementation((() => undefined) as typeof process.getBuiltinModule);

    const { loadConfig } = await import('./index.js');

    expect(() => loadConfig({ envFilePath: '.env' })).toThrow(expect.objectContaining({
      code: 'CONFIG_RUNTIME_UNAVAILABLE',
      cause: expect.objectContaining({
        message: expect.stringContaining('Node.js 20.16.0 or newer is required'),
      }),
    }));
  });
});
