import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  EventBusModuleOptions,
  EventBusTransport,
  EventDeliveryOutcome,
  EventDeliveryStatus,
  EventDeliveryTarget,
  EventPublishOptions,
  EventPublishResult,
  EventPublishSettlement,
  EventType,
} from './index.js';
import { EventBusService } from './index.js';
import * as eventBusPublicApi from './index.js';

describe('@fluojs/event-bus public API surface', () => {
  it('exposes EventBusService with a single consolidated publish method returning EventPublishResult', () => {
    expectTypeOf<EventBusService['publish']>().returns.toEqualTypeOf<Promise<EventPublishResult>>();
    expectTypeOf<EventBusService['createPlatformStatusSnapshot']>().toBeFunction();
    expectTypeOf<EventDeliveryTarget['kind']>().toEqualTypeOf<'handler' | 'transport'>();
    expectTypeOf<EventDeliveryOutcome>().toExtend<EventDeliveryStatus>();
    expectTypeOf<Extract<EventPublishResult, { status: 'background' }>['completion']>()
      .toEqualTypeOf<Promise<EventPublishSettlement>>();
    expectTypeOf<Extract<EventDeliveryStatus, { status: 'timed-out' }>['timeoutMs']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<EventDeliveryStatus, { status: 'cancelled' }>['started']>().toEqualTypeOf<boolean>();
  });

  it('keeps documented supported root-barrel exports and excludes removed symbols', () => {
    expect(eventBusPublicApi).toHaveProperty('EventBusModule');
    expect(eventBusPublicApi).toHaveProperty('EventBusService');
    expect(eventBusPublicApi).toHaveProperty('OnEvent');
    expect(eventBusPublicApi).toHaveProperty('createEventBusPlatformStatusSnapshot');

    // Removed symbols with no compatibility aliases
    expect(eventBusPublicApi).not.toHaveProperty('EVENT_BUS');
    expect(eventBusPublicApi).not.toHaveProperty('EventBusLifecycleService');
    expect(eventBusPublicApi).not.toHaveProperty('publishWithResult');
    expect(eventBusPublicApi).not.toHaveProperty('EventBus');
    expect(eventBusPublicApi).not.toHaveProperty('EventBusWithResults');
  });

  it('keeps documented TypeScript-only contracts', () => {
    expectTypeOf<EventBusTransport>().toHaveProperty('publish');
    expectTypeOf<EventBusTransport>().toHaveProperty('subscribe');
    expectTypeOf<EventBusTransport>().toHaveProperty('close');
    expectTypeOf<EventPublishOptions>().toMatchTypeOf<{
      signal?: AbortSignal;
      timeoutMs?: number;
      waitForHandlers?: boolean;
    }>();
    expectTypeOf<EventBusModuleOptions>().toMatchTypeOf<{
      global?: boolean;
      publish?: {
        timeoutMs?: number;
        waitForHandlers?: boolean;
      };
      shutdown?: {
        drainTimeoutMs?: number;
      };
      transport?: EventBusTransport;
    }>();
    expectTypeOf<EventType>().toMatchTypeOf<new (...args: never[]) => object>();
  });

  it('hides internal descriptors and metadata helpers from the root barrel', () => {
    expect(eventBusPublicApi).not.toHaveProperty('createEventBusProviders');
    expect(eventBusPublicApi).not.toHaveProperty('defineEventHandlerMetadata');
    expect(eventBusPublicApi).not.toHaveProperty('getEventHandlerMetadata');
    expect(eventBusPublicApi).not.toHaveProperty('getEventHandlerMetadataEntries');
    expect(eventBusPublicApi).not.toHaveProperty('eventBusMetadataSymbol');
    expect(eventBusPublicApi).not.toHaveProperty('EVENT_BUS_OPTIONS');
    expect(eventBusPublicApi).not.toHaveProperty('EventHandlerDescriptor');
    expect(eventBusPublicApi).not.toHaveProperty('EventHandlerMetadata');
    expect(eventBusPublicApi).not.toHaveProperty('EVENT_BUS_SHUTDOWN_COORDINATOR');
  });
});
