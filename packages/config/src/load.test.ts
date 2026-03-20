import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { describe, expect, it } from 'vitest';

import { loadConfig } from './load.js';
import { ConfigService } from './service.js';

describe('loadConfig', () => {
  it('merges defaults, env file, process env, and runtime overrides in order', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'konekti-config-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'PORT=4000\nNAME=from-file\n');

    const loaded = loadConfig({
      cwd,
      defaults: { NAME: 'from-default', PORT: '3000' },
      mode: 'dev',
      processEnv: { NAME: 'from-process' },
      runtimeOverrides: { NAME: 'from-runtime' },
    });

    expect(loaded).toMatchObject({
      NAME: 'from-runtime',
      PORT: '4000',
    });
  });

  it('does not let undefined process env values overwrite file/default values', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'konekti-config-undefined-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'PORT=4000\n');

    const loaded = loadConfig({
      cwd,
      defaults: { PORT: '3000' },
      mode: 'dev',
      processEnv: { PORT: undefined },
    });

    expect(loaded).toMatchObject({ PORT: '4000' });
  });

  it('fails when validation rejects the merged config', () => {
    expect(() =>
      loadConfig({
        mode: 'test',
        validate: () => {
          throw new Error('PORT is required');
        },
      }),
    ).toThrow('Invalid configuration.');
  });

  it('parses multiline values from env files using dotenv', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'konekti-config-multiline-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\\nMIIEowIBAAKCAQ\\n-----END RSA PRIVATE KEY-----"\n');

    const loaded = loadConfig({ cwd, mode: 'dev', processEnv: {} });

    expect(loaded['PRIVATE_KEY']).toContain('BEGIN RSA PRIVATE KEY');
    expect(loaded['PRIVATE_KEY']).toContain('\n');
  });

  it('expands variable interpolation in env files', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'konekti-config-expand-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'DB_HOST=localhost\nDB_PORT=5432\nDATABASE_URL=${DB_HOST}:${DB_PORT}/mydb\n');

    const loaded = loadConfig({ cwd, mode: 'dev', processEnv: {} });

    expect(loaded['DATABASE_URL']).toBe('localhost:5432/mydb');
  });

  it('uses a custom parse function when provided', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'konekti-config-custom-'));
    const envPath = join(cwd, '.env.dev');

    writeFileSync(envPath, 'KEY: value\n');

    const loaded = loadConfig({
      cwd,
      mode: 'dev',
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
});

describe('ConfigService', () => {
  it('reads required and optional keys', () => {
    const service = new ConfigService({ PORT: '3000' });

    expect(service.get('PORT')).toBe('3000');
    expect(service.getOptional('MISSING' as never)).toBeUndefined();
  });

  it('resolves nested dot-path keys', () => {
    const service = new ConfigService({ db: { host: 'localhost', port: 5432 } });

    expect(service.get('db.host')).toBe('localhost');
    expect(service.get('db.port')).toBe(5432);
  });

  it('throws on missing required key', () => {
    const service = new ConfigService({ PORT: '3000' });

    expect(() => service.get('MISSING' as never)).toThrow('Missing config key');
  });

  it('returns undefined for missing optional nested key', () => {
    const service = new ConfigService({ db: { host: 'localhost' } });

    expect(service.getOptional('db.missing' as never)).toBeUndefined();
  });

  it('does not resolve inherited top-level keys', () => {
    const values = Object.create({ PORT: '3000' }) as Record<string, unknown>;
    const service = new ConfigService(values);

    expect(service.getOptional('PORT' as never)).toBeUndefined();
    expect(() => service.get('PORT' as never)).toThrow('Missing config key');
  });

  it('does not resolve inherited nested keys', () => {
    const db = Object.create({ host: 'localhost' }) as Record<string, unknown>;
    const service = new ConfigService({ db });

    expect(service.getOptional('db.host' as never)).toBeUndefined();
    expect(() => service.get('db.host' as never)).toThrow('Missing config key');
  });

  it('provides typed get/getOptional for generic ConfigService', () => {
    type AppConfig = { PORT: string; DB_URL: string };
    const service = new ConfigService<AppConfig>({ PORT: '3000', DB_URL: 'postgres://localhost' });

    const port = service.get('PORT');
    const dbUrl = service.getOptional('DB_URL');

    expect(port).toBe('3000');
    expect(dbUrl).toBe('postgres://localhost');
  });
});
