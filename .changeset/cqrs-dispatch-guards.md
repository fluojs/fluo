---
"@fluojs/cqrs": major
---

Reject CQRS command, query, event, and direct saga dispatch after shutdown has completed, preventing stopped applications from starting new local handler or saga work. Also detect aliased duplicate command/query handlers by provider token while preserving event-handler and saga fan-out for aliased providers.
