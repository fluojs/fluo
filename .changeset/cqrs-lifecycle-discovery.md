---
"@fluojs/cqrs": patch
---

Harden CQRS discovery and shutdown behavior so duplicate command/query provider aliases fail discovery, event-handler aliases keep fan-out semantics, and stopped applications ignore new CQRS publishes or saga dispatches instead of running local handlers.
