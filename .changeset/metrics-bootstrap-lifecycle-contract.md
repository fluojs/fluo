---
"@fluojs/metrics": patch
---

Harden metrics lifecycle ownership so isolated registries, services, meter providers, and platform telemetry are created at application bootstrap boundaries instead of dynamic module definition time, while preserving shared-registry scrape collision guards.
