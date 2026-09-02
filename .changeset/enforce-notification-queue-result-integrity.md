---
"@fluojs/notifications": major
---

Reject malformed queue-assigned delivery IDs consistently for single enqueue, native bulk enqueue, and sequential bulk fallback paths, and export `NotificationQueueResultIntegrityError` for caller classification.

Migration: Queue adapters must resolve every `enqueue()` call and every `enqueueMany()` result entry with a non-empty string. Update adapters that return empty, missing, or non-string values: these results now reject instead of being reported as queued deliveries. Catch `NotificationQueueResultIntegrityError` where applications classify adapter integration failures.
