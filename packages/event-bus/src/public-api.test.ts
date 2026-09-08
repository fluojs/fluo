import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
  EventBus,
  EventBusModuleOptions,
  EventBusTransport,
  EventBusWithResults,
  EventDeliveryOutcome,
  EventDeliveryStatus,
  EventDeliveryTarget,
  EventPublishOptions,
  EventPublishResult,
  EventPublishSettlement,
  EventType,
} from './index.js';
import * as eventBusPublicApi from './index.js';

describe('@fluojs/event-bus public API surface', () => {
  it('adds typed observations without requiring new methods on existing EventBus implementations', () => {
    // Given
    const legacy: EventBus = { async publish() {} };

    // When / Then
    expectTypeOf(legacy).toEqualTypeOf<EventBus>();
    expectTypeOf<EventBusWithResults>().toExtend<EventBus>();
    expectTypeOf<EventBusWithResults['publishWithResult']>().returns.toEqualTypeOf<Promise<EventPublishResult>>();
    expectTypeOf<EventDeliveryTarget['kind']>().toEqualTypeOf<'handler' | 'transport'>();
    expectTypeOf<EventDeliveryOutcome>().toExtend<EventDeliveryStatus>();
    expectTypeOf<Extract<EventPublishResult, { status: 'background' }>['completion']>()
      .toEqualTypeOf<Promise<EventPublishSettlement>>();
    expectTypeOf<Extract<EventDeliveryStatus, { status: 'timed-out' }>['timeoutMs']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<EventDeliveryStatus, { status: 'cancelled' }>['started']>().toEqualTypeOf<boolean>();
  });
  it('keeps documented supported root-barrel exports', () => {
    expect(eventBusPublicApi).toHaveProperty('EventBusModule');
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
  });
});
