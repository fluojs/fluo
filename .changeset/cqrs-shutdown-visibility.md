---
"@fluojs/cqrs": patch
---

Reject CQRS event publishes and direct saga dispatches as soon as runtime shutdown starts, and keep delegated event-bus providers module-local by default when `CqrsModule.forRoot({ global: false })` is used.
