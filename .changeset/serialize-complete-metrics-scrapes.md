---
"@fluojs/metrics": patch
---

Serialize each platform telemetry refresh and Prometheus render as one complete
scrape snapshot when concurrent callers share a registry.
