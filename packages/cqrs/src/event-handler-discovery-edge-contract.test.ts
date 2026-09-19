import { type ApplicationLogger } from '@fluojs/runtime';
import { describe, expect, it } from 'vitest';

import { discoverEventHandlerDescriptors } from './buses/event-handler-discovery.js';
import { EventHandler } from './decorators.js';
import type { DiscoveryCandidate } from './discovery.js';
import type { IEvent, IEventHandler } from './types.js';

function createLogger(warnings: string[]): ApplicationLogger {
  return {
    debug: () => undefined,
    error: () => undefined,
    log: () => undefined,
    warn(message: string): void {
      warnings.push(message);
    },
  };
}

describe('CQRS event-handler discovery dedupe contracts', () => {
  it('deduplicates repeated registrations for the same provider token and event type', () => {
    // Given
    class DedupeEvent implements IEvent {}

    @EventHandler(DedupeEvent)
    class DedupeHandler implements IEventHandler<DedupeEvent> {
      handle(): void {}
    }

    const warnings: string[] = [];
    const candidate: DiscoveryCandidate = {
      moduleName: 'AppModule',
      scope: 'singleton',
      targetType: DedupeHandler,
      token: DedupeHandler,
    };

    // When
    const descriptors = discoverEventHandlerDescriptors([candidate, candidate], createLogger(warnings));

    // Then
    expect(descriptors).toEqual([
      expect.objectContaining({
        eventType: DedupeEvent,
        targetType: DedupeHandler,
        token: DedupeHandler,
      }),
    ]);
    expect(warnings).toEqual([]);
  });

  it('retains one registration for each distinct provider token', () => {
    // Given
    const FIRST_TOKEN = Symbol('FIRST_EVENT_HANDLER');
    const SECOND_TOKEN = Symbol('SECOND_EVENT_HANDLER');

    class SharedEvent implements IEvent {}

    @EventHandler(SharedEvent)
    class SharedHandler implements IEventHandler<SharedEvent> {
      handle(): void {}
    }

    const warnings: string[] = [];

    // When
    const descriptors = discoverEventHandlerDescriptors(
      [
        {
          moduleName: 'AppModule',
          scope: 'singleton',
          targetType: SharedHandler,
          token: FIRST_TOKEN,
        },
        {
          moduleName: 'AppModule',
          scope: 'singleton',
          targetType: SharedHandler,
          token: SECOND_TOKEN,
        },
      ],
      createLogger(warnings),
    );

    // Then
    expect(descriptors.map((descriptor) => descriptor.token)).toEqual([FIRST_TOKEN, SECOND_TOKEN]);
    expect(warnings).toEqual([]);
  });

  it('filters out superseded handler candidates when duplicate provider tokens claim different classes', () => {
    const SHARED_TOKEN = Symbol('SHARED_EVENT_HANDLER');

    class EventOne implements IEvent {}
    class EventTwo implements IEvent {}

    @EventHandler(EventOne)
    class HandlerOne implements IEventHandler<EventOne> {
      handle(): void {}
    }

    @EventHandler(EventTwo)
    class HandlerTwo implements IEventHandler<EventTwo> {
      handle(): void {}
    }

    const warnings: string[] = [];

    const descriptors = discoverEventHandlerDescriptors(
      [
        {
          moduleName: 'ModuleA',
          scope: 'singleton',
          targetType: HandlerOne,
          token: SHARED_TOKEN,
        },
        {
          moduleName: 'ModuleB',
          scope: 'singleton',
          targetType: HandlerTwo,
          token: SHARED_TOKEN,
        },
      ],
      createLogger(warnings),
    );

    // Only the winning provider identity creates a descriptor
    expect(descriptors).toEqual([
      expect.objectContaining({
        eventType: EventTwo,
        moduleName: 'ModuleB',
        targetType: HandlerTwo,
        token: SHARED_TOKEN,
      }),
    ]);
    expect(warnings).toEqual([]);
  });
});

