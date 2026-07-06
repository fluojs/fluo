---
"@fluojs/di": patch
"@fluojs/testing": patch
---

Harden DI introspection snapshots and override stale-instance disposal ordering so framework-owned state cannot be observed through live maps and replacement resolution waits for stale teardown failures. Update testing module sync cache adoption to consume the snapshot introspection contract.
