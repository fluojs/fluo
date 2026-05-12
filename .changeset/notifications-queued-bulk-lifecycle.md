---
"@fluojs/notifications": patch
---

Ensure queued bulk notification dispatch publishes terminal lifecycle events for every requested notification and reports partial sequential enqueue fallback results when `continueOnError` is enabled.
