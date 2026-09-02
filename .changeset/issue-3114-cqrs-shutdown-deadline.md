---
'@fluojs/cqrs': patch
'@fluojs/event-bus': patch
---

Enforce one bounded CQRS shutdown deadline across active event pipelines, saga drains, and delegated Event Bus publication. Existing `shutdown.drainTimeoutMs` configuration remains unchanged.
