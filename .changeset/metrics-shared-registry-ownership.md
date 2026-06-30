---
'@fluojs/metrics': major
---

Validate shared-registry HTTP collector path-label configuration before reuse and keep platform telemetry stale-series ownership scoped to the reused registry.

Migration note: applications that pass the same Prometheus registry to multiple `MetricsModule.forRoot(...)` calls must now use matching HTTP path-label configuration for framework-owned collectors. Align `pathLabelMode`, reuse the same `pathLabelNormalizer` function reference when a custom normalizer is configured, and keep `unknownPathLabel` consistent across module instances before sharing a registry. If different HTTP path-label policies are required, use separate registries for those module instances.
