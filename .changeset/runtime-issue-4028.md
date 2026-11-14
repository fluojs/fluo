---
"@fluojs/runtime": patch
---

Continue microservice teardown when the synchronous shutdown-start notification throws. Wait for active startup, attempt transport and owned-context cleanup once, and preserve notification and cleanup failures in the cached terminal close result.
