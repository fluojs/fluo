---
'@fluojs/platform-express': patch
---

Make duplicate Express adapter `listen()` calls idempotent while preserving the live dispatcher, and document the SSE and lifecycle contract alongside regression coverage for retry exhaustion, idle keep-alive drain, and native-route fallback parity.
