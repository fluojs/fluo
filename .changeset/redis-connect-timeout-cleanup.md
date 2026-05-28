---
"@fluojs/redis": patch
---

Disconnect lifecycle-owned Redis clients when bootstrap `connect()` times out so in-flight connection attempts are cleaned up before startup failure propagates, and document the exported default and named Redis module option types in the package README API lists.
