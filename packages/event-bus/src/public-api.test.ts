import { describe, expect, expectTypeOf, it } from 'vitest';

import * as eventBusPublicApi from './index.js';
import type {
  EventBus,
  EventBusModuleOptions,
  EventBusTransport,
  EventPublishOptions,
  EventType,
} from './index.js';

describe('@konekti/event-bus public API surface', () => {
  it('keeps documented supported root-barrel exports', () => {
    expect(eventBusPublicApi).toHaveProperty('EventBusModule');
    expect(eventBusPublicApi).toHaveProperty('createEventBusProviders');
    expect(eventBusPublicApi).toHaveProperty('EventBusLifecycleService');
    expect(eventBusPublicApi).toHaveProperty('EVENT_BUS');
    expect(eventBusPublicApi).toHaveProperty('OnEvent');
    expect(eventBusPublicApi).toHaveProperty('createEventBusPlatformStatusSnapshot');
  });

  it('keeps documented TypeScript-only contracts', () => {
    expectTypeOf<EventBus>().toHaveProperty('publish');
    expectTypeOf<EventBusTransport>().toHaveProperty('publish');
    expectTypeOf<EventBusTransport>().toHaveProperty('subscribe');
    expectTypeOf<EventBusTransport>().toHaveProperty('close');
    expectTypeOf<EventPublishOptions>().toMatchTypeOf<{
      signal?: AbortSignal;
      timeoutMs?: number;
      waitForHandlers?: boolean;
    }>();
    expectTypeOf<EventBusModuleOptions>().toMatchTypeOf<{
      publish?: {
        timeoutMs?: number;
        waitForHandlers?: boolean;
      };
      transport?: EventBusTransport;
    }>();
    expectTypeOf<EventType>().toMatchTypeOf<new (...args: never[]) => object>();
  });

  it('hides internal descriptors and metadata helpers from the root barrel', () => {
    expect(eventBusPublicApi).not.toHaveProperty('defineEventHandlerMetadata');
    expect(eventBusPublicApi).not.toHaveProperty('getEventHandlerMetadata');
    expect(eventBusPublicApi).not.toHaveProperty('getEventHandlerMetadataEntries');
    expect(eventBusPublicApi).not.toHaveProperty('eventBusMetadataSymbol');
    expect(eventBusPublicApi).not.toHaveProperty('EVENT_BUS_OPTIONS');
    expect(eventBusPublicApi).not.toHaveProperty('EventHandlerDescriptor');
    expect(eventBusPublicApi).not.toHaveProperty('EventHandlerMetadata');
  });
});
