---
"@fluojs/runtime": patch
---

Wait for application-owned asynchronous runtime cleanup callbacks before `close()` or bootstrap-failure cleanup settles. Cleanup remains best-effort: later callbacks run after failures, close aggregates failures for explicit retry, and bootstrap preserves the original bootstrap error.
