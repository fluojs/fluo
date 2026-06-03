---
"@fluojs/queue": patch
---

Fix queue readiness snapshots so workers are only reported ready after BullMQ processors start, and expose worker start failures through lifecycle/status diagnostics.

This is a readiness bug fix: status snapshots now distinguish worker startup failure from healthy startup and avoid reporting ready before BullMQ processors are actually running.
