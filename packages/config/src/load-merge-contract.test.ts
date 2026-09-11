import { describe, expect, it } from 'vitest';

import { ConfigModule } from './module.js';

describe('ConfigModule.load deep merge contract', () => {
  it('replaces top-level and nested arrays from higher-precedence sources instead of merging elements', () => {
    const loaded = ConfigModule.load({
      defaults: {
        featureFlags: ['default-alpha', 'default-beta'],
        nested: {
          endpoints: ['https://default.example.test'],
          policies: [{ levels: ['read'], name: 'default-policy' }],
        },
        routes: [{ methods: ['GET'], path: '/default' }],
      },
      processEnv: {},
      runtimeOverrides: {
        featureFlags: ['runtime-only'],
        nested: {
          endpoints: ['https://runtime.example.test'],
          policies: [{ levels: ['write'], name: 'runtime-policy' }],
        },
        routes: [{ methods: ['POST'], path: '/runtime' }],
      },
    });

    expect(loaded).toEqual({
      featureFlags: ['runtime-only'],
      nested: {
        endpoints: ['https://runtime.example.test'],
        policies: [{ levels: ['write'], name: 'runtime-policy' }],
      },
      routes: [{ methods: ['POST'], path: '/runtime' }],
    });
  });

  it('treats empty higher-precedence arrays as explicit replacements', () => {
    const loaded = ConfigModule.load({
      defaults: {
        featureFlags: ['default-alpha'],
        nested: {
          endpoints: ['https://default.example.test'],
        },
      },
      processEnv: {},
      runtimeOverrides: {
        featureFlags: [],
        nested: {
          endpoints: [],
        },
      },
    });

    expect(loaded).toEqual({
      featureFlags: [],
      nested: {
        endpoints: [],
      },
    });
  });
});
