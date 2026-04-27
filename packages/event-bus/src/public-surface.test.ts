import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as eventBus from './index.js';
import * as redisEventBus from './transports/redis-transport.js';

describe('@fluojs/event-bus root barrel public surface', () => {
  it('keeps the documented root exports stable for 0.x governance', () => {
    expect(eventBus).toHaveProperty('EventBusModule');
    expect(eventBus).not.toHaveProperty('createEventBusModule');
    expect(eventBus).not.toHaveProperty('createEventBusProviders');
    expect(eventBus).toHaveProperty('EventBusLifecycleService');
    expect(eventBus).toHaveProperty('EVENT_BUS');
    expect(eventBus).not.toHaveProperty('EVENT_BUS_OPTIONS');
    expect(eventBus).toHaveProperty('OnEvent');
    expect(eventBus).toHaveProperty('createEventBusPlatformStatusSnapshot');
    expect(eventBus).not.toHaveProperty('defineEventHandlerMetadata');
    expect(eventBus).not.toHaveProperty('getEventHandlerMetadata');
    expect(eventBus).not.toHaveProperty('getEventHandlerMetadataEntries');
    expect(eventBus).not.toHaveProperty('eventBusMetadataSymbol');
    expect(Object.keys(eventBus).sort()).toMatchSnapshot();
  });

  it('keeps Redis transport isolated behind the documented redis subpath', () => {
    expect(eventBus).not.toHaveProperty('RedisEventBusTransport');
    expect(redisEventBus).toHaveProperty('RedisEventBusTransport');

    const packageJson = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'),
    ) as {
      exports: Record<string, { import: string; types: string }>;
    };

    expect(packageJson.exports).toEqual({
      '.': {
        import: './dist/index.js',
        types: './dist/index.d.ts',
      },
      './redis': {
        import: './dist/transports/redis-transport.js',
        types: './dist/transports/redis-transport.d.ts',
      },
    });
  });
});
