import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as eventBus from './index.js';
import * as integration from './integration.js';
import * as redisEventBus from './transports/redis-transport.js';

describe('@fluojs/event-bus root barrel public surface', () => {
  it('keeps the documented root exports stable for 0.x governance', () => {
    expect(eventBus).toHaveProperty('EventBusModule');
    expect(eventBus).toHaveProperty('EventBusService');
    expect(eventBus).not.toHaveProperty('EventBusLifecycleService');
    expect(eventBus).not.toHaveProperty('EVENT_BUS');
    expect(eventBus).not.toHaveProperty('createEventBusModule');
    expect(eventBus).not.toHaveProperty('createEventBusProviders');
    expect(eventBus).not.toHaveProperty('EVENT_BUS_OPTIONS');
    expect(eventBus).toHaveProperty('OnEvent');
    expect(eventBus).toHaveProperty('createEventBusPlatformStatusSnapshot');
    expect(eventBus).not.toHaveProperty('defineEventHandlerMetadata');
    expect(eventBus).not.toHaveProperty('getEventHandlerMetadata');
    expect(eventBus).not.toHaveProperty('getEventHandlerMetadataEntries');
    expect(eventBus).not.toHaveProperty('eventBusMetadataSymbol');
    expect(Object.keys(eventBus).sort()).toMatchSnapshot();
  });

  it('keeps Redis transport and first-party integration isolated behind documented subpaths', () => {
    expect(eventBus).not.toHaveProperty('RedisEventBusTransport');
    expect(redisEventBus).toHaveProperty('RedisEventBusTransport');
    expect(eventBus).not.toHaveProperty('EVENT_BUS_SHUTDOWN_COORDINATOR');
    expect(integration).toHaveProperty('EVENT_BUS_SHUTDOWN_COORDINATOR');

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
      './integration': {
        import: './dist/integration.js',
        types: './dist/integration.d.ts',
      },
    });
  });
});
