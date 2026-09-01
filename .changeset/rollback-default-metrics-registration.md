---
"@fluojs/metrics": patch
---

Roll back partially registered default collectors when `prom-client` registration
fails so a later clean bootstrap can retry the registry.
