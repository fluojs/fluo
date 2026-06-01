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
});
