---
"@fluojs/runtime": minor
"@fluojs/cli": patch
---

Add `HealthModule.forRoot(...)` as the application-facing runtime health facade and update generated starters to use it while preserving the deprecated `createHealthModule(...)` compatibility helper.
