---
"@fluojs/queue": patch
---

Fix queue readiness snapshots so workers are only reported ready after BullMQ processors start, and expose worker start failures through lifecycle/status diagnostics.
