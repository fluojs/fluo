---
"@fluojs/notifications": major
---

Reject malformed queue-assigned delivery IDs consistently for single enqueue, native bulk enqueue, and sequential bulk fallback paths, and export `NotificationQueueResultIntegrityError` for caller classification.

Migration: Queue adapters must resolve every `enqueue()` call and every `enqueueMany()` result entry with a non-empty string. Native `enqueueMany()` results must be dense arrays with own data-property entries and exactly the count of jobs admitted before adapter invocation. Update adapters that return empty, missing, non-string, accessor-backed, sparse, or length-drifting results: these now reject instead of being reported as queued deliveries. Catch `NotificationQueueResultIntegrityError` where applications classify adapter integration failures.
