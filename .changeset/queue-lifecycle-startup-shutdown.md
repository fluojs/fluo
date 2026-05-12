---
"@fluojs/queue": patch
---

Start Queue processors after the bootstrap-ready handoff, bound worker shutdown with `workerShutdownTimeoutMs`, and document the lifecycle/status options so stuck processors cannot block application shutdown indefinitely.
