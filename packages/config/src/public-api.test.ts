import { describe, expect, it } from 'vitest';

import * as configPublicApi from './index.js';

describe('@fluojs/config public API surface', () => {
  it('keeps documented root-barrel exports', () => {
    expect(configPublicApi).toHaveProperty('ConfigModule');
    expect(configPublicApi).toHaveProperty('ConfigReloadManager');
    expect(configPublicApi).toHaveProperty('CONFIG_RELOADER');
    expect(configPublicApi).toHaveProperty('ConfigService');
    expect(configPublicApi.ConfigModule).toHaveProperty('load');
    expect(configPublicApi.ConfigReloadManager).toHaveProperty('create');
    expect(configPublicApi).not.toHaveProperty('createConfigReloader');
    expect(configPublicApi).not.toHaveProperty('loadConfig');
    expect(configPublicApi).not.toHaveProperty('replaceConfigServiceSnapshot');
    expect(configPublicApi).not.toHaveProperty('ConfigReloadModule');
  });

  it('keeps ConfigService read-only from the public API', () => {
    const service = new configPublicApi.ConfigService({ PORT: '3000' });

    expect(service).not.toHaveProperty('getOptional');
    expect(service).not.toHaveProperty('_replaceSnapshot');
    expect(typeof service.get).toBe('function');
    expect(typeof service.getOrThrow).toBe('function');
    expect(typeof service.snapshot).toBe('function');
  });
});
