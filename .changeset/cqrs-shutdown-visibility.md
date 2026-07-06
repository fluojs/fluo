---
"@fluojs/cqrs": major
---

Reject CQRS event publishes and direct saga dispatches as soon as runtime shutdown starts, drain late nested saga work until the saga queue is quiescent, and keep delegated event-bus providers module-local by default when `CqrsModule.forRoot({ global: false })` is used.

Migration note: applications that intentionally relied on delegated `@fluojs/event-bus` providers remaining globally visible while using `CqrsModule.forRoot({ global: false })` must now either pass `eventBus: { global: true }` explicitly or import the CQRS module into consumers that inject delegated event-bus tokens.
