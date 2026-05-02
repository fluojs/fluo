---
"@fluojs/di": patch
---

Preserve DI shutdown progress when request-scope child disposal fails, aggregate child/root disposal failures, and reject singleton dependency graphs that reach request scope through transient or factory providers.
