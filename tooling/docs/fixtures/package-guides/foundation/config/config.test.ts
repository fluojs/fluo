import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ConfigModule, ConfigReloadManager, type ConfigSchema, ConfigService } from '@fluojs/config';
import { FluoError, Module } from '@fluojs/core';
import { FluoFactory } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

/**
 * @fluojs/config guide evidence: source precedence, deep merge vs replacement,
 * synchronous Standard Schema validation, injected dot-path access with clone
 * semantics, and the standalone reload manager contract - all deterministic,
 * manual reloads (no watch polling).
 */

const requireStringKey = (key: string): ConfigSchema => ({
  '~standard': {
    version: 1,
    vendor: 'docs-foundation-fixture',
    validate(value: unknown) {
      if (typeof value !== 'object' || value === null) {
        return { issues: [{ message: 'config must be an object' }] };
      }

      const dictionary = value as Record<string, unknown>;
      if (typeof dictionary[key] !== 'string' || (dictionary[key] as string).length === 0) {
        return { issues: [{ message: `${key} must be a non-empty string` }] };
      }

      return { value: dictionary };
    },
  },
});

describe('@fluojs/config guide examples', () => {
  it('merges env sources, process env, defaults, and runtime overrides in precedence order', () => {
    const snapshot = ConfigModule.load({
      defaults: {
        SHARED: 'fromdefault',
        NESTED: { A: '1', B: 'fromdefault' },
        ARRAY: ['a'],
      },
      processEnv: { SHARED: 'fromprocess' },
      runtimeOverrides: {
        SHARED: 'fromoverride',
        NESTED: { B: 'fromoverride' },
        ARRAY: ['x'],
      },
      envFilePaths: [],
    });
    const config = new ConfigService(snapshot);

    expect(config.get('SHARED')).toBe('fromoverride');
    // Plain objects deep-merge across tiers; arrays are replaced wholesale.
    expect(config.get('NESTED.A')).toBe('1');
    expect(config.get('NESTED.B')).toBe('fromoverride');
    expect(config.get('ARRAY')).toEqual(['x']);
  });

  it('validates the merged snapshot with a synchronous Standard Schema validator', async () => {
    const dir = join(tmpdir(), `fluo-config-fixture-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    try {
      const envPath = join(dir, '.env.fixture');
      await writeFile(envPath, 'FEATURE=base\n', 'utf8');

      const valid = new ConfigService(
        ConfigModule.load({
          envFilePaths: [envPath],
          processEnv: {},
          schema: requireStringKey('FEATURE'),
        }),
      );
      expect(valid.get('FEATURE')).toBe('base');

      expect(() => {
        ConfigModule.load({
          envFilePaths: [],
          processEnv: {},
          schema: requireStringKey('MISSING_KEY'),
        });
      }).toThrowError(FluoError);

      try {
        ConfigModule.load({
          envFilePaths: [],
          processEnv: {},
          schema: requireStringKey('MISSING_KEY'),
        });
      } catch (error: unknown) {
        expect((error as FluoError).code).toBe('INVALID_CONFIG');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('registers ConfigService with dot-path access and detached clones', async () => {
    @Module({
      imports: [
        ConfigModule.forRoot({
          envFilePaths: [],
          runtimeOverrides: { APP: { NAME: 'fixture', PORTS: [1, 2] } },
        }),
      ],
    })
    class ConfigRootModule {}

    const context = await FluoFactory.createApplicationContext(ConfigRootModule);
    try {
      const config = await context.get(ConfigService);
      expect(config.get('APP.NAME')).toBe('fixture');
      expect(config.getOrThrow('APP.PORTS')).toEqual([1, 2]);

      const clone = config.get('APP');
      if (typeof clone !== 'object' || clone === null || Array.isArray(clone)) {
        throw new TypeError('expected object clone');
      }
      (clone as Record<string, unknown>).NAME = 'mutated';
      expect(config.get('APP.NAME')).toBe('fixture');

      expect(() => config.getOrThrow('APP.MISSING')).toThrowError(FluoError);
      try {
        config.getOrThrow('APP.MISSING');
      } catch (error: unknown) {
        expect((error as FluoError).code).toBe('CONFIG_KEY_MISSING');
      }
    } finally {
      await context.close();
    }
  });

  it('reloads snapshots through the standalone manager with rollback on listener failure', async () => {
    const dir = join(tmpdir(), `fluo-config-reload-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const envPath = join(dir, '.env.reload');
    let manager: ConfigReloadManager | undefined;

    try {
      await writeFile(envPath, 'BASE=1\n', 'utf8');
      const reloader = ConfigReloadManager.create({ envFilePaths: [envPath], watch: false });
      manager = reloader;
      expect(reloader.current().BASE).toBe('1');

      await writeFile(envPath, 'BASE=2\n', 'utf8');
      expect(reloader.reload().BASE).toBe('2');
      expect(reloader.current().BASE).toBe('2');

      let receivedReason: string | undefined;
      const subscription = reloader.subscribe((_snapshot, reason) => {
        receivedReason = reason;
      });

      const failing = reloader.subscribe(() => {
        throw new Error('listener boom');
      });

      await writeFile(envPath, 'BASE=3\n', 'utf8');
      expect(() => reloader.reload()).toThrow('listener boom');
      // The listener failure rolls the snapshot back to the last committed value.
      expect(reloader.current().BASE).toBe('2');

      failing.unsubscribe();

      await writeFile(envPath, 'BASE=4\n', 'utf8');
      expect(reloader.reload().BASE).toBe('4');
      expect(receivedReason).toBe('manual');
      subscription.unsubscribe();

      reloader.close();
      expect(() => reloader.reload()).toThrow();
      expect(reloader.current().BASE).toBe('4');
    } finally {
      manager?.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
