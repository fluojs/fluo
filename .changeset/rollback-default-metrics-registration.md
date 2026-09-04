---
"@fluojs/metrics": patch
---

Preflight active `prom-client` default-collector collisions before registration can
trigger side effects, and roll back collectors from unexpected registration failures
so a later clean bootstrap can retry the registry.
