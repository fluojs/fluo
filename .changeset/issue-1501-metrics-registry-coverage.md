---
"@fluojs/metrics": patch
---

Reuse built-in HTTP metrics when multiple MetricsModule instances intentionally share one registry, while documenting that HTTP instrumentation requires the explicit `http` option.
