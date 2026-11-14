---
"@fluojs/terminus": patch
---

Document the separate default 5000 ms runtime callback budget for Terminus `/ready`. Indicator or platform work that exceeds this budget returns HTTP 503 unavailable. `TerminusModuleOptions` currently cannot raise the callback budget, and increasing indicator or platform probe timeouts alone does not extend it.
