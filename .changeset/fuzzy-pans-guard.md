---
"@fluojs/http": patch
---

Guard request-context storage resolution so importing `@fluojs/http` does not crash when host `async_hooks` probes throw, while preserving lazy ALS resolution and synchronous fallback behavior.
