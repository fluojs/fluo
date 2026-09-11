import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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

  it('keeps standalone loading and reloader creation owned by static APIs', () => {
    // Given: the emitted public module implementation and its lower-level state builder.
    const moduleSource = readFileSync(fileURLToPath(new URL('./module.ts', import.meta.url)), 'utf8');
    const loadSource = readFileSync(fileURLToPath(new URL('./load.ts', import.meta.url)), 'utf8');

    // Then: public static methods perform their own assembly instead of forwarding to removed free APIs.
    expect(moduleSource).toMatch(
      /static load\(options: ConfigLoadOptions\): ConfigDictionary \{\s+const normalized = normalizeConfigLoadOptions\(options\);\s+return cloneConfigDictionary\(resolveConfigSnapshot\(normalized\)\);/s,
    );
    expect(moduleSource).toContain('ConfigReloadCore.create(this.options, initialSnapshot)');
    expect(loadSource).not.toContain('export function loadConfig(');
    expect(loadSource).not.toContain('export function createConfigReloader(');
  });
});
