---
'@fluojs/event-bus': major
---

Fail EventBus bootstrap when discovered handler targets cannot be resolved, and limit factory-provider handler discovery to explicit class-token handlers so unrelated singleton factories are not invoked during readiness wiring.

Migration notes:

- If an event handler was registered through a symbol or string token `useFactory` provider, register that factory under the handler class token instead, for example `{ provide: OrderEventsHandler, useFactory: () => new OrderEventsHandler(...) }`, or provide a prebuilt metadata-bearing handler instance with `useValue`.
- If application bootstrap now fails with an unresolved discovered handler, make that handler's constructor dependencies visible and resolvable from its module graph before importing `EventBusModule.forRoot(...)`; the event bus now treats unresolved discovered handlers as a readiness failure instead of silently skipping them.
