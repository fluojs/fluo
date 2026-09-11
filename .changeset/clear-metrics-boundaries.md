---
'@fluojs/metrics': patch
---

Move low-level Prometheus integration APIs to `@fluojs/metrics/integration` and remove the `MetricsModule.forRoot({ registry })` input. Applications now share a registry only by providing `METRICS_REGISTRY` to `FluoFactory.create(...)`; migrate each independent application with its own bootstrap provider.
