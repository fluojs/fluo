import { Inject, Module } from '@fluojs/core';
import { EventBusModule, OnEvent, type EventBusModuleOptions } from '@fluojs/event-bus';

import { createDeferred, type Deferred } from './helpers';

/**
 * Complete canonical event-bus application from the Event bus guide
 * (apps/docs/content/docs/packages/event-bus.mdx), extended with the
 * inheritance lineage, timeout, and background events the guide explains.
 * Guide fixtures compile this app with the real event bus.
 */

/** The guide's stable-key event: transport channel name is pinned by eventKey. */
export class UserSignedUpEvent {
  static readonly eventKey = 'account.signed-up.v1';

  constructor(public readonly email: string) {}
}

/** Base event: matches subclass publications through instanceof. */
export class DomainEvent {}

export class OrderPlacedEvent extends DomainEvent {
  constructor(public readonly orderId: string) {
    super();
  }
}

/** Event used to observe per-call timeout bounds on a blocked handler. */
export class SlowEvent {
  constructor(public readonly payload: string) {}
}

/** Event with no handler and (by default) no transport: publish returns no-recipients. */
export class UnheardEvent {}

/**
 * Application-owned observation seam. Handlers record deliveries here and
 * tests await them through event barriers - never through sleeps.
 */
export class EventProbe {
  readonly delivered: object[] = [];

  private readonly deliveryWaiters: Array<{ count: number; resolve: () => void }> = [];
  private holdGate: Deferred<void> | undefined;

  record(event: object): void {
    this.delivered.push(event);
    this.flushDeliveryWaiters();
  }

  waitDeliveries(count: number): Promise<void> {
    if (this.delivered.length >= count) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.deliveryWaiters.push({ count, resolve });
    });
  }

  /** Makes the slow handler block until `release()` is called. */
  hold(): void {
    this.holdGate = createDeferred<void>();
  }

  release(): void {
    this.holdGate?.resolve();
    this.holdGate = undefined;
  }

  waitIfHeld(): Promise<void> {
    return this.holdGate ? this.holdGate.promise : Promise.resolve();
  }

  private flushDeliveryWaiters(): void {
    for (const waiter of this.deliveryWaiters.splice(0)) {
      if (this.delivered.length >= waiter.count) {
        waiter.resolve();
      }
    }
  }
}

@Inject(EventProbe)
export class GuideHandlers {
  constructor(private readonly probe: EventProbe) {}

  @OnEvent(UserSignedUpEvent)
  async sendWelcomeEmail(event: UserSignedUpEvent): Promise<void> {
    this.probe.record(event);
  }

  @OnEvent(DomainEvent)
  async projectDomainEvent(event: DomainEvent): Promise<void> {
    this.probe.record(event);
  }

  @OnEvent(SlowEvent)
  async handleSlowEvent(event: SlowEvent): Promise<void> {
    await this.probe.waitIfHeld();
    this.probe.record(event);
  }
}

export function createEventBusGuideApp(eventBusOptions: EventBusModuleOptions = {}) {
  @Module({
    imports: [EventBusModule.forRoot(eventBusOptions)],
    providers: [GuideHandlers, EventProbe],
  })
  class EventBusGuideAppModule {}

  return { AppModule: EventBusGuideAppModule, GuideHandlers, EventProbe };
}
