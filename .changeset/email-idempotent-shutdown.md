---
"@fluojs/email": patch
---

Make repeated and concurrent Email service shutdown calls share one cleanup operation so owned transports close at most once.
