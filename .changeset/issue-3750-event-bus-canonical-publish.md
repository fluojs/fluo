---
"@fluojs/event-bus": major
"@fluojs/cqrs": patch
"@fluojs/notifications": major
---

**BREAKING:** `EventBusService.publish(event, options?)` now returns `Promise<EventPublishResult>` and is the sole public Event Bus publication path. Migrate from `publishWithResult`, `EVENT_BUS`, `EventBus`, `EventBusWithResults`, and root `EventBusLifecycleService` with no compatibility aliases. Inspect `settled` outcomes, `no-recipients`, lifecycle rejection, and background completion on the single result path; outbound handler and transport errors remain safely logged without raw errors. Use `@fluojs/event-bus/integration` only for first-party shutdown coordination.

CQRS now delegates through `EventBusService` while preserving its own `Promise<void>` event API. Notifications lifecycle publishers may return an ignored publication observation result so they can accept the Event Bus service directly.
