---
"@fluojs/metrics": minor
"@fluojs/runtime": patch
---

Configure a shared Prometheus registry through the public `METRICS_REGISTRY`
bootstrap provider so each application bootstrap owns its metrics registry. Bootstrap
registry provenance is available to runtime integrations through the narrow internal
provider-token seam.
