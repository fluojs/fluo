---
"@fluojs/cqrs": patch
---

Reject new CQRS event publishes and direct saga dispatches once shutdown has started while still draining already active publish and saga work.
