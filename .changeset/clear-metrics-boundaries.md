---
'@fluojs/metrics': patch
---

Move low-level Prometheus integration APIs, including `Registry`, to `@fluojs/metrics/integration` and remove the `MetricsModule.forRoot({ registry })` input. Import `Registry` from the integration subpath, then share a registry only by providing `METRICS_REGISTRY` to `FluoFactory.create(..., { providers })`; migrate each independent application with its own bootstrap provider.
