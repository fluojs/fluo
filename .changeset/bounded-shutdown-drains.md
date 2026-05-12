---
"@fluojs/event-bus": patch
"@fluojs/cqrs": patch
---

Bound event-bus and CQRS shutdown drains so stuck handlers, sagas, or delegated publish chains report degraded diagnostics and no longer hang application close indefinitely.
