# Observed workerd diagnostic during timing

Completion note (2026-10-08): the historical observation below was written
while the original invocation was running. The final shard collection retained
2,112 valid timing samples with zero HTTP correctness counters; see
`timing-collection-audit-20261008.json`. The warning was also observed during
the later `stage-body` concurrency-64 run. Zero HTTP counters do not resolve
the request-context diagnostic or prove uncontaminated capacity.

The default-configuration concurrency-64 timing invocation at source
`b02cde867cab4b9dd2dc7824f8c5ee177639899b` emitted repeated workerd diagnostics
while `fluo-workers` was running. The monitor was in its first repetition near
`stage-dto-validation`; exact condition attribution must be checked against
the complete terminal log before aggregation.

```text
Warning: A promise was resolved or rejected from a different request context
than the one it was created in. However, the creating request has already been
completed or canceled.
packages/platform-cloudflare-workers/dist/adapter.js:185:29
```

The referenced generated line calls `this.inFlightDrain?.resolve()` when
the adapter's in-flight request count reaches zero. This identifies the
diagnostic location, not a proven performance root cause.

Wrangler reported this raw log path:
`/Users/ayden/Library/Preferences/.wrangler/logs/wrangler-2026-10-03_18-51-43_846.log`.

The target completed its measured invocation and the runner proceeded to
Next.js. Final HTTP counters are not yet available because the overall
invocation is still running. Do not infer error-free behavior from that
transition, suppress the warning, change compatibility flags, or label
warning-affected throughput as uncontaminated. Preserve and inspect the raw
log and completed measurement before bottleneck attribution.
